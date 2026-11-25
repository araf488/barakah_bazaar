import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config';
import { PaymentTransaction, PaymentTransactionStatus } from '../../infra/prisma/prisma-client';
import { BkashCheckoutService } from './bkash-checkout.service';
import { PaymentConstants, PaymentTokens, SettleResults } from './payment.constants';
import { PaymentRepository, RefundOwed } from './payment.repository';
import { CheckoutOutcome, PaymentGateway } from './ports/payment-gateway.port';

const MS_PER_MINUTE = PaymentConstants.SecondsPerMinute * PaymentConstants.MillisecondsPerSecond;
const ABANDON_AFTER_MS =
  PaymentConstants.AbandonAfterHours * PaymentConstants.MinutesPerHour * MS_PER_MINUTE;
const RECONCILE_AFTER_MS = PaymentConstants.ReconcileAfterMinutes * MS_PER_MINUTE;
const REFUND_COOLDOWN_MS = PaymentConstants.RefundRetryCooldownMinutes * MS_PER_MINUTE;
const ATTEMPT_COOLDOWN_MS = PaymentConstants.ReconcileRetryCooldownMinutes * MS_PER_MINUTE;

/**
 * How one attempt ended up in a pass. `open` means bKash has not decided yet; `stuck` means bKash
 * says it completed but the ledger could not capture it, which only a person can resolve.
 */
type AttemptVerdict = 'settled' | 'open' | 'stuck' | 'failed';

/** Running counts for one pass, logged when it finishes. */
interface SweepTally {
  examined: number;
  settled: number;
  refunded: number;
  failed: number;
}

/**
 * Finishes the bKash payments the customer's browser never reported back (spec §6).
 *
 * Three jobs per pass: ask bKash about attempts still PENDING and settle what it says; give back
 * money an order is owed; and report refund claims stuck PENDING. A stuck claim is **never**
 * released or retried here. It is left PENDING after an ambiguous answer or a refund bKash made
 * that could not be recorded, so money may already have moved and a retry could pay out twice.
 *
 * An attempt is never abandoned without asking bKash first: one older than the abandonment
 * window is closed FAILED only when bKash explicitly answers `pending`. An `error` answer (bKash
 * unreachable, or a reply that could not be read, which can be a completed payment) never closes
 * anything: the attempt stays PENDING, is logged at error, and is asked about again. A
 * `completed` answer goes through `settle`, which confirms or refunds, because closing it would
 * lose money bKash already took.
 *
 * Same shape as the reservation sweeper: a plain interval, `unref`'d, never rethrows. Two
 * instances sweeping at once is harmless, since every step is conditional or claim-guarded.
 */
@Injectable()
export class BkashReconciliationSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  /**
   * Charges whose refund failed, by charge id, with when. They sit out of the batch for the
   * cooldown so a refund bKash keeps refusing cannot starve the ones queued behind it. In memory
   * and per instance: losing it on restart only means one early retry.
   */
  private readonly failedRefunds = new Map<string, number>();

  /**
   * Attempts bKash left undecided, by attempt id, with when it was asked. Same idea and same
   * limits as `failedRefunds`: skipping only saves work, since abandoning always needs a fresh
   * query and the attempt's own conditional writes stay the guard against double settling.
   */
  private readonly undecidedAttempts = new Map<string, number>();

  /**
   * True while a pass runs on this instance. A pass can outlast the interval (fifty bKash queries,
   * then fifty refunds), and an overlapping one only doubles the calls to bKash, so the next tick
   * is skipped instead. Per instance: replicas still overlap, which claims and conditional writes
   * keep safe.
   */
  private passRunning = false;

  constructor(
    private readonly payments: PaymentRepository,
    private readonly checkout: BkashCheckoutService,
    @Inject(PaymentTokens.PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(BkashReconciliationSweeper.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.sweep(),
      PaymentConstants.ReconcileIntervalMinutes * MS_PER_MINUTE,
    );

    // Never hold the process open for the next tick; shutdown should not wait on a timer.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** One pass. Public so the suite and any future queue worker can drive it directly. */
  async sweep(): Promise<void> {
    // Checked before the try, so a skipped tick never reaches the `finally` that would clear the
    // flag of the pass still running.
    if (this.passRunning) {
      this.logger.warn('bKash reconciliation is still running; skipping this tick');
      return;
    }

    this.passRunning = true;
    try {
      if (this.config.get('PAYMENT_PROVIDER', { infer: true }) === PaymentConstants.NoopProvider) {
        return;
      }

      const now = Date.now();
      const tally: SweepTally = { examined: 0, settled: 0, refunded: 0, failed: 0 };

      const stuckAttemptIds = await this.reconcileAttempts(now, tally);
      await this.refundOwed(now, tally);
      await this.reportStuck(now, stuckAttemptIds);

      if (tally.examined > 0) {
        this.logger.info(tally, 'bKash reconciliation finished');
      }
    } catch (error) {
      // Never rethrow. An unhandled rejection from a timer callback takes the process down,
      // and a failed sweep costs nothing that the next tick cannot recover.
      this.logger.error({ err: error }, 'Exception occurred in BkashReconciliationSweeper.sweep');
    } finally {
      this.passRunning = false;
    }
  }

  /**
   * Pass one: ask bKash about each attempt still PENDING after the grace period. Answers the ids
   * of attempts bKash completed but the ledger could not capture, for the stuck report.
   */
  private async reconcileAttempts(now: number, tally: SweepTally): Promise<string[]> {
    BkashReconciliationSweeper.forgetExpired(this.undecidedAttempts, now, ATTEMPT_COOLDOWN_MS);

    // Ask for one extra row per set-aside attempt, so they cannot eat into the batch.
    const attempts = await this.payments.findPendingAttempts(
      new Date(now - RECONCILE_AFTER_MS),
      PaymentConstants.ReconcileBatchSize + this.undecidedAttempts.size,
    );

    if (attempts === null) {
      this.logger.warn('bKash reconciliation could not read pending attempts; will retry');
      return [];
    }

    const ready = attempts
      .filter((attempt) => !this.undecidedAttempts.has(attempt.id))
      .slice(0, PaymentConstants.ReconcileBatchSize);
    const stuck: string[] = [];

    for (const attempt of ready) {
      tally.examined += 1;
      const verdict = await this.reconcileAttempt(attempt, now);

      if (verdict === 'stuck') {
        stuck.push(attempt.id);
      }

      if (verdict === 'open' || verdict === 'stuck') {
        this.undecidedAttempts.set(attempt.id, now);
      } else {
        tally[verdict] += 1;
      }
    }

    return stuck;
  }

  /** One attempt. A fault stays with this attempt, so the rest of the batch still runs. */
  private async reconcileAttempt(
    attempt: PaymentTransaction,
    now: number,
  ): Promise<AttemptVerdict> {
    try {
      if (!attempt.gatewayReference) {
        this.logger.error({ attemptId: attempt.id }, 'bKash attempt has no payment reference');
        return 'failed';
      }

      const outcome = await this.gateway.queryCheckout(attempt.gatewayReference);

      if (outcome.kind === 'pending' && BkashReconciliationSweeper.pastWindow(attempt, now)) {
        return await this.abandon(attempt);
      }

      const result = await this.checkout.settle(attempt, outcome);

      if (result === null) {
        return 'failed';
      }

      if (result !== SettleResults.Pending) {
        return 'settled';
      }

      // Completed at bKash yet still PENDING here: the capture could not be written (a trxID
      // already on another row), and asking again will not change that.
      if (outcome.kind === 'completed') {
        return 'stuck';
      }

      this.reportUnreadable(attempt, outcome, now);
      return 'open';
    } catch (error) {
      this.logger.error(
        { err: error, attemptId: attempt.id },
        'Exception occurred in BkashReconciliationSweeper while reconciling an attempt',
      );
      return 'failed';
    }
  }

  private static pastWindow(attempt: PaymentTransaction, now: number): boolean {
    return now - attempt.createdAt.getTime() > ABANDON_AFTER_MS;
  }

  /**
   * An `error` answer is never grounds to close an attempt, because it can hide a payment bKash
   * completed. Past the window it is surfaced every pass, with the id only, so a person sees an
   * attempt bKash cannot be read for. Younger ones are ordinary transient faults.
   */
  private reportUnreadable(
    attempt: PaymentTransaction,
    outcome: CheckoutOutcome,
    now: number,
  ): void {
    if (outcome.kind === 'error' && BkashReconciliationSweeper.pastWindow(attempt, now)) {
      this.logger.error(
        { attemptId: attempt.id },
        'bKash could not say how an old attempt ended; keeping it for the next pass',
      );
    }
  }

  private async abandon(attempt: PaymentTransaction): Promise<AttemptVerdict> {
    const closed = await this.payments.closeAttempt(
      attempt.id,
      PaymentTransactionStatus.FAILED,
      PaymentConstants.AbandonedAttemptReason,
    );

    if (closed === null) {
      return 'failed';
    }

    this.logger.info({ attemptId: attempt.id, closed }, 'bKash attempt abandoned after waiting');
    return 'settled';
  }

  /** Pass two: refund what orders are owed, setting aside charges whose refund just failed. */
  private async refundOwed(now: number, tally: SweepTally): Promise<void> {
    BkashReconciliationSweeper.forgetExpired(this.failedRefunds, now, REFUND_COOLDOWN_MS);

    // Ask for one extra row per set-aside charge, so they cannot eat into the batch.
    const entries = await this.payments.findRefundsOwed(
      PaymentConstants.ReconcileBatchSize + this.failedRefunds.size,
    );

    if (entries === null) {
      this.logger.warn('bKash reconciliation could not read refunds owed; will retry');
      return;
    }

    const ready = entries
      .filter((entry) => !this.failedRefunds.has(entry.charge.id))
      .slice(0, PaymentConstants.ReconcileBatchSize);

    for (const entry of ready) {
      tally.examined += 1;

      if (await this.refund(entry, now)) {
        tally.refunded += 1;
      } else {
        tally.failed += 1;
      }
    }
  }

  private async refund(entry: RefundOwed, now: number): Promise<boolean> {
    try {
      if (await this.checkout.refundNow(entry)) {
        return true;
      }
    } catch (error) {
      this.logger.error(
        { err: error, orderId: entry.orderId },
        'Exception occurred in BkashReconciliationSweeper while refunding',
      );
    }

    this.failedRefunds.set(entry.charge.id, now);
    return false;
  }

  private static forgetExpired(
    setAside: Map<string, number>,
    now: number,
    cooldownMs: number,
  ): void {
    for (const [id, since] of setAside) {
      if (now - since >= cooldownMs) {
        setAside.delete(id);
      }
    }
  }

  /**
   * Pass three: surface what only a person can finish: attempts bKash completed that this pass
   * could not capture, and refund claims left PENDING. Only ever read and logged, never touched.
   */
  private async reportStuck(now: number, stuckAttemptIds: string[]): Promise<void> {
    if (stuckAttemptIds.length > 0) {
      this.logger.error(
        { count: stuckAttemptIds.length, attemptIds: stuckAttemptIds },
        'bKash attempts completed at bKash are stuck pending and need a person to reconcile them',
      );
    }

    const claims = await this.payments.findStaleRefundClaims(
      new Date(now - RECONCILE_AFTER_MS),
      PaymentConstants.ReconcileBatchSize,
    );

    if (claims === null) {
      this.logger.warn('bKash reconciliation could not read stuck refund claims; will retry');
      return;
    }

    if (claims.length > 0) {
      this.logger.error(
        { count: claims.length, claimIds: claims.map((claim) => claim.id) },
        'bKash refund claims are stuck pending and need a person to reconcile them',
      );
    }
  }
}

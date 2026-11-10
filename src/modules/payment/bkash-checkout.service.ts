import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationConstants } from '../../common/constants/app.constants';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AppConfigService } from '../../config';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../../infra/prisma/prisma-client';
import { NotificationService } from '../notification/notification.service';
import { OrderRepository, OrderWithDetail } from '../order/order.repository';
import { BkashCheckoutStartedDto } from './dto/bkash.dto';
import {
  BkashOutcome,
  BkashOutcomeWord,
  PaymentConstants,
  PaymentMessages,
  PaymentTokens,
  SettleResult,
  SettleResults,
} from './payment.constants';
import {
  ClosedAttemptStatus,
  PAYMENT_DUPLICATE,
  PaymentRepository,
  REFUND_CLAIMED,
  RefundOwed,
} from './payment.repository';
import { joinUrl } from './payment-url';
import { CheckoutOutcome, GatewayRefundResult, PaymentGateway } from './ports/payment-gateway.port';

/** What the callback tells the storefront: how the payment ended, and which order it was. */
export interface CallbackResult {
  outcome: BkashOutcomeWord;
  /** Null when no attempt could be found for the `paymentID`, so there is nothing to quote. */
  orderNumber: string | null;
}

type CompletedOutcome = Extract<CheckoutOutcome, { kind: 'completed' }>;

/** The order fields a bKash payment is checked against. */
type PayableOrder = Pick<
  OrderWithDetail,
  'id' | 'orderNumber' | 'status' | 'paymentMethod' | 'paymentStatus' | 'totalPoysha'
>;

/** Seconds a bKash attempt stays open: what the customer is told, and how far the hold moves. */
const ATTEMPT_WINDOW_SECONDS =
  PaymentConstants.BkashAttemptWindowMinutes * PaymentConstants.SecondsPerMinute;

/**
 * bKash Tokenized Checkout: starting a payment, settling what bKash says happened, and giving
 * back money an order could not keep.
 *
 * `settle` is the single path an outcome takes, whether the customer's browser brought it back
 * through the callback or the reconciliation sweep asked bKash. Every step is conditional in the
 * repository, so a replayed or concurrent outcome changes nothing the first one did not.
 */
@Injectable()
export class BkashCheckoutService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly orders: OrderRepository,
    @Inject(PaymentTokens.PaymentGateway) private readonly gateway: PaymentGateway,
    private readonly notifications: NotificationService,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(BkashCheckoutService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Starts a bKash payment for the customer's own order (spec §4): checks the order can still
   * be paid, asks bKash for a hosted checkout, and opens the attempt with the stock hold
   * stretched to cover it. The response carries only where to go and for how long.
   */
  async start(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<ServiceResponse<BkashCheckoutStartedDto>> {
    try {
      const order = await this.orders.findForUser(user.userId, orderId);

      if (order === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
      }

      if (order === undefined) {
        return serviceFail(HttpStatus.NOT_FOUND, PaymentMessages.OrderNotFound);
      }

      const refusal = await this.refusalFor(order);
      if (refusal) {
        return refusal;
      }

      return await this.open(order);
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in BkashCheckoutService.start',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Everything the browser callback does (spec §4): finds the attempt by bKash's `paymentID`,
   * answers a terminal attempt from the ledger, otherwise asks bKash and settles. The query
   * string only picks the call: `status` of `success` executes the payment, anything else reads
   * it. The outcome always comes from bKash and the ledger.
   *
   * Never throws. An unknown id or a failed lookup is `failed` with no order. Once the attempt
   * is found, a fault decides nothing, so it reads `pending` and the sweep finishes the job.
   */
  async handleCallback(paymentId: string, status: string | undefined): Promise<CallbackResult> {
    try {
      const found = await this.payments.findAttemptWithOrderNumber(paymentId);

      if (!found) {
        return { outcome: BkashOutcome.Failed, orderNumber: null };
      }

      return {
        outcome: await this.callbackOutcome(found.attempt, paymentId, status),
        orderNumber: found.orderNumber,
      };
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in BkashCheckoutService.handleCallback',
      );
      return { outcome: BkashOutcome.Failed, orderNumber: null };
    }
  }

  /**
   * Settles a found attempt and words the result for the customer. A `pending` result is
   * checked against the ledger once more: a second, simultaneous callback finds bKash refusing
   * to execute a payment the first one already captured, and must still be told `paid`.
   */
  private async callbackOutcome(
    attempt: PaymentTransaction,
    paymentId: string,
    status: string | undefined,
  ): Promise<BkashOutcomeWord> {
    try {
      if (attempt.status !== PaymentTransactionStatus.PENDING) {
        return BkashCheckoutService.wordFor(await this.resultOf(attempt));
      }

      const outcome = await this.askBkash(paymentId, status);
      const result = await this.settle(attempt, outcome);

      return BkashCheckoutService.wordFor(
        result === SettleResults.Pending ? await this.reread(attempt) : result,
      );
    } catch (error) {
      this.logger.error(
        { err: error, attemptId: attempt.id },
        'Exception occurred in BkashCheckoutService.handleCallback while settling',
      );
      return BkashOutcome.Pending;
    }
  }

  /** Executes only when the browser says `success`; any other status just reads. */
  private askBkash(paymentId: string, status: string | undefined): Promise<CheckoutOutcome> {
    return status === PaymentConstants.CallbackSuccessStatus
      ? this.gateway.executeCheckout(paymentId)
      : this.gateway.queryCheckout(paymentId);
  }

  /** `refunded` is money given back, so the customer is told `failed`; a fault reads `pending`. */
  private static wordFor(result: SettleResult | null): BkashOutcomeWord {
    if (result === null) {
      return BkashOutcome.Pending;
    }

    return result === SettleResults.Refunded ? BkashOutcome.Failed : result;
  }

  /**
   * Settles what bKash said about an attempt (spec §5) and answers how it ended. `null` means
   * nothing could be decided (a read or write failed), so the attempt is left for the sweep.
   */
  async settle(
    attempt: PaymentTransaction,
    outcome: CheckoutOutcome,
  ): Promise<SettleResult | null> {
    try {
      switch (outcome.kind) {
        case 'completed':
          return await this.settleCompleted(attempt, outcome);
        case 'failed':
        case 'expired':
          return await this.close(
            attempt,
            PaymentTransactionStatus.FAILED,
            outcome.reason,
            SettleResults.Failed,
          );
        case 'cancelled':
          return await this.close(
            attempt,
            PaymentTransactionStatus.CANCELLED,
            outcome.reason,
            SettleResults.Cancelled,
          );
        default:
          // `pending` and `error` decide nothing: the customer may still pay, or may have.
          return SettleResults.Pending;
      }
    } catch (error) {
      this.logger.error(
        { err: error, attemptId: attempt.id },
        'Exception occurred in BkashCheckoutService.settle',
      );
      return null;
    }
  }

  /**
   * How an attempt reads now, for a replayed callback or a settle someone else finished.
   *
   * A CAPTURED attempt reads as `paid` only while its order is a paid bKash order; otherwise the
   * money was, or is being, given back. With two captured attempts on one paid order, both read
   * as `paid`: the order is paid, and the second capture is refunded automatically.
   */
  async resultOf(attempt: PaymentTransaction): Promise<SettleResult | null> {
    try {
      switch (attempt.status) {
        case PaymentTransactionStatus.PENDING:
          return SettleResults.Pending;
        case PaymentTransactionStatus.FAILED:
          return SettleResults.Failed;
        case PaymentTransactionStatus.CANCELLED:
          return SettleResults.Cancelled;
        default:
          return await this.capturedResult(attempt.orderId);
      }
    } catch (error) {
      this.logger.error(
        { err: error, attemptId: attempt.id },
        'Exception occurred in BkashCheckoutService.resultOf',
      );
      return null;
    }
  }

  /**
   * Gives back what an order is owed from one captured bKash charge, by its trxID. Shared by
   * settle and the reconciliation sweep, which pass the entry `PaymentRepository` computed.
   *
   * The refund is **claimed before bKash is called** (ruling R9): a PENDING refund row whose
   * unique reference names the charge, so only one pass, on any replica, can ever ask bKash to
   * refund it. A definitive refusal releases the claim for a later pass; an unknown outcome, or a
   * refund bKash made that could not be recorded, keeps it, because retrying could pay out twice.
   *
   * Never throws. `true` only when the refund is recorded; `false` means it is still owed,
   * claimed elsewhere, or held for reconciliation.
   */
  async refundNow(entry: RefundOwed): Promise<boolean> {
    const { orderId, charge } = entry;

    try {
      if (!charge.gatewayReference) {
        this.logger.error(
          { orderId, chargeId: charge.id },
          'bKash charge has no payment reference to refund',
        );
        return false;
      }

      const claim = await this.payments.claimRefund(orderId, charge, entry.amountPoysha);

      if (claim === REFUND_CLAIMED) {
        return false;
      }

      if (claim === null) {
        this.logger.error(
          { orderId, chargeId: charge.id },
          'bKash automatic refund could not be claimed',
        );
        return false;
      }

      const result = await this.gateway.refund({
        amountPoysha: entry.amountPoysha,
        originalReference: charge.gatewayReference,
        transactionId: charge.gatewayTransactionId,
      });

      return await this.finishRefund(entry, claim.id, result);
    } catch (error) {
      this.logger.error(
        { err: error, orderId, chargeId: charge.id },
        'Exception occurred in BkashCheckoutService.refundNow',
      );
      return false;
    }
  }

  /** The §4 409s in the spec's order, then the hold, then whether bKash is configured at all. */
  private async refusalFor(order: PayableOrder): Promise<ServiceResponse<never> | null> {
    const stateRefusal = BkashCheckoutService.stateRefusal(order);
    if (stateRefusal) {
      return stateRefusal;
    }

    const held = await this.orders.holdActive(order.id);

    if (held === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    if (!held) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.PaymentWindowClosed);
    }

    if (this.config.get('PAYMENT_PROVIDER', { infer: true }) === PaymentConstants.NoopProvider) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.BkashUnavailable);
    }

    return null;
  }

  private static stateRefusal(order: PayableOrder): ServiceResponse<never> | null {
    if (order.paymentMethod !== PaymentMethod.BKASH) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.NotBkashOrder);
    }

    if (order.status !== OrderStatus.PLACED) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.OrderNotPayable);
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.AlreadyPaid);
    }

    return null;
  }

  /** Asks bKash for the checkout, then opens the attempt and stretches the hold together. */
  private async open(order: PayableOrder): Promise<ServiceResponse<BkashCheckoutStartedDto>> {
    const checkout = await this.gateway.createCheckout({
      amountPoysha: order.totalPoysha,
      orderNumber: order.orderNumber,
      callbackUrl: this.callbackUrl(),
      // An opaque id bKash files the payment under. The order number, never a phone number.
      payerReference: order.orderNumber,
    });

    if (!checkout.ok) {
      this.logger.warn(
        { orderId: order.id, failureReason: checkout.failureReason },
        'bKash did not create a checkout',
      );
      return serviceFail(HttpStatus.BAD_GATEWAY, PaymentMessages.GatewayUnavailable);
    }

    const holdUntil = new Date(
      Date.now() + ATTEMPT_WINDOW_SECONDS * PaymentConstants.MillisecondsPerSecond,
    );
    const attempt = await this.payments.createAttempt(
      { orderId: order.id, amountPoysha: order.totalPoysha, paymentId: checkout.paymentId },
      holdUntil,
    );

    if (attempt === PAYMENT_DUPLICATE) {
      return serviceFail(HttpStatus.BAD_GATEWAY, PaymentMessages.GatewayUnavailable);
    }

    if (attempt === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    return serviceOk({
      redirectUrl: checkout.redirectUrl,
      expiresInSeconds: ATTEMPT_WINDOW_SECONDS,
    });
  }

  /** Trailing slashes on the base are dropped, so the callback never lands on a `//` path. */
  private callbackUrl(): string {
    return joinUrl(
      this.config.get('API_PUBLIC_BASE_URL', { infer: true }),
      PaymentConstants.CallbackPath,
    );
  }

  /**
   * A completed payment confirms the order only when it is exactly what the attempt asked for.
   * Anything else was still money taken (ruling R19): it is captured at the amount bKash reported,
   * never confirms the order, and is refunded like any capture the order cannot keep.
   */
  private async settleCompleted(
    attempt: PaymentTransaction,
    outcome: CompletedOutcome,
  ): Promise<SettleResult | null> {
    const order = await this.orders.findById(attempt.orderId);

    if (!order) {
      return null;
    }

    if (!BkashCheckoutService.matches(attempt, order, outcome)) {
      this.logger.error(
        { attemptId: attempt.id, orderId: attempt.orderId, transactionId: outcome.transactionId },
        'bKash completed a payment that does not match its attempt',
      );
      return await this.captureMismatch(attempt, outcome);
    }

    const capture = await this.payments.captureAttempt(attempt.id, outcome.transactionId);

    if (capture === null) {
      return null;
    }

    switch (capture.kind) {
      case 'confirmed':
        await this.announce(capture.order);
        return SettleResults.Paid;
      case 'refund-due':
        await this.refundCapture(capture.orderId);
        return SettleResults.Refunded;
      default:
        return await this.reread(attempt);
    }
  }

  /**
   * Records a mismatched completion at what bKash took and gives that back straight away, through
   * the same claim-before-call refund the sweeper uses. Settled by someone else answers what the
   * attempt became; a failed write decides nothing and leaves it for the sweep.
   */
  private async captureMismatch(
    attempt: PaymentTransaction,
    outcome: CompletedOutcome,
  ): Promise<SettleResult | null> {
    const captured = await this.payments.captureMismatched(
      attempt.id,
      outcome.transactionId,
      outcome.amountPoysha,
    );

    if (captured === null) {
      return null;
    }

    if (!captured) {
      return await this.reread(attempt);
    }

    await this.refundCapture(attempt.orderId);
    return SettleResults.Refunded;
  }

  private static matches(
    attempt: PaymentTransaction,
    order: PayableOrder,
    outcome: CompletedOutcome,
  ): boolean {
    return (
      outcome.amountPoysha === attempt.amountPoysha &&
      outcome.currency === ApplicationConstants.CurrencyCode &&
      outcome.orderNumber === order.orderNumber
    );
  }

  /** Closes a PENDING attempt; one someone else already settled answers what it became. */
  private async close(
    attempt: PaymentTransaction,
    status: ClosedAttemptStatus,
    reason: string,
    result: SettleResult,
  ): Promise<SettleResult | null> {
    const closed = await this.payments.closeAttempt(attempt.id, status, reason);

    if (closed === null) {
      return null;
    }

    return closed ? result : await this.reread(attempt);
  }

  private async reread(attempt: PaymentTransaction): Promise<SettleResult | null> {
    if (!attempt.gatewayReference) {
      return null;
    }

    const current = await this.payments.findAttemptByPaymentId(attempt.gatewayReference);
    return current ? await this.resultOf(current) : null;
  }

  private async capturedResult(orderId: string): Promise<SettleResult | null> {
    const order = await this.orders.findById(orderId);

    if (!order) {
      return null;
    }

    const kept =
      order.paymentMethod === PaymentMethod.BKASH && order.paymentStatus === PaymentStatus.PAID;
    return kept ? SettleResults.Paid : SettleResults.Refunded;
  }

  /**
   * Refunds a capture the order could not take, straight away. The amount and whether it clears
   * the order come from the same owed rule the sweep uses. A failed read leaves it to the sweep.
   */
  private async refundCapture(orderId: string): Promise<void> {
    const entry = await this.payments.findRefundOwedForOrder(orderId);

    if (entry === undefined) {
      this.logger.info({ orderId }, 'Nothing left to refund on this bKash order');
      return;
    }

    if (entry !== null) {
      await this.refundNow(entry);
    }
  }

  /** Settles a claim by what bKash answered. Only a definitive refusal gives the claim up. */
  private async finishRefund(
    entry: RefundOwed,
    claimId: string,
    result: GatewayRefundResult,
  ): Promise<boolean> {
    const context = { orderId: entry.orderId, chargeId: entry.charge.id };

    if (result.ok) {
      const completed = await this.payments.completeRefund(
        claimId,
        result.reference,
        entry.markRefunded,
      );
      if (completed !== true) {
        // The money went back. The claim stays PENDING so no pass refunds this charge again.
        this.logger.error(
          { ...context, claimId },
          'bKash refund succeeded but could not be recorded',
        );
      }
      return completed === true;
    }

    if (result.ambiguous) {
      this.logger.error(
        { ...context, claimId, failureReason: result.failureReason },
        'bKash refund outcome unknown; claim left for reconciliation',
      );
      return false;
    }

    const released = await this.payments.releaseRefundClaim(claimId);
    this.logger.error(
      { ...context, failureReason: result.failureReason, released },
      'bKash automatic refund failed',
    );
    return false;
  }

  /**
   * Sends the CONFIRMED message, built the way OrderService builds it. The capture has
   * committed, so a failure here is logged and never turns a paid order into an error.
   */
  private async announce(order: OrderWithDetail): Promise<void> {
    try {
      await this.notifications.notifyOrderStatus(OrderStatus.CONFIRMED, {
        userId: order.userId,
        // The phone snapshotted onto the order: whoever the customer chose to receive it.
        phone: order.phone,
        orderId: order.id,
        orderNumber: order.orderNumber,
        recipientName: order.recipientName,
        totalPoysha: order.totalPoysha,
      });
    } catch (error) {
      this.logger.error(
        { err: error, orderId: order.id },
        'bKash payment captured but could not be announced',
      );
    }
  }
}

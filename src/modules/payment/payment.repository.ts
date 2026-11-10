import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaErrorCodes } from '../../common/constants/app.constants';
import {
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  Prisma,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from '../admin/audit-log.repository';
import { OrderConstants } from '../order/order.constants';
import { OrderWithDetail, orderInclude } from '../order/order.repository';
import { PaymentConstants } from './payment.constants';

export interface RecordPaymentData {
  orderId: string;
  method: PaymentMethod;
  direction: PaymentDirection;
  status: PaymentTransactionStatus;
  amountPoysha: bigint;
  gatewayReference: string | null;
  collectedBy: string | null;
  failureReason: string | null;
}

export interface PaymentPage {
  items: PaymentTransaction[];
  total: number;
}

/** What an order has actually taken and given back. */
export interface PaymentTotals {
  capturedPoysha: bigint;
  refundedPoysha: bigint;
}

/** What a bKash attempt is opened with: the order, what it costs, and bKash's `paymentID`. */
export interface BkashAttemptData {
  orderId: string;
  amountPoysha: bigint;
  paymentId: string;
}

/** A bKash attempt and the number of the order it pays for. */
export interface AttemptWithOrderNumber {
  attempt: PaymentTransaction;
  orderNumber: string;
}

/** The two ways a PENDING attempt ends without money moving. */
export type ClosedAttemptStatus =
  typeof PaymentTransactionStatus.FAILED | typeof PaymentTransactionStatus.CANCELLED;

/** What a unique index refusing the row is reported as: the row already exists. */
export const PAYMENT_DUPLICATE = 'duplicate' as const;

/** What `claimRefund` answers when another pass already holds the refund for that charge. */
export const REFUND_CLAIMED = 'claimed' as const;

/**
 * How a completed bKash payment landed.
 *
 * `refund-due` means the money was captured but the order could not take it (cancelled,
 * switched to cash, or already paid by another attempt). The capture is committed with no
 * matching refund row, which is exactly what the reconciliation sweep looks for.
 */
export type CaptureResult =
  | { kind: 'confirmed'; order: OrderWithDetail }
  | { kind: 'refund-due'; orderId: string }
  | { kind: 'already-settled' };

/** A captured bKash charge the business has no right to keep, and the order it belongs to. */
export interface RefundOwed {
  orderId: string;
  charge: PaymentTransaction;
  /**
   * What to give back from this charge: the smaller of what the order is owed and the charge
   * itself. Less than the charge when staff already refunded part of the order by hand.
   */
  amountPoysha: bigint;
  /**
   * True when the order is CANCELLED and this refund clears everything it is owed, so the
   * refund also marks its payment REFUNDED. A refund that leaves money owed does not.
   */
  markRefunded: boolean;
}

/** Whether an order is cancelled, and what it is still owed back by the §6 rule. */
export interface OrderOwed {
  cancelled: boolean;
  /** Owed now, with every PENDING refund claim netted as already given back (ruling R11). */
  owedPoysha: bigint;
}

/**
 * Whether a refund of `amountPoysha` clears everything a cancelled order is owed, and so also
 * marks its payment REFUNDED. `owedBeforePoysha` is what the order is owed *before* this refund.
 * The one rule both the automatic refund and a staff resolution of a claim apply.
 */
export const refundClearsOrder = (
  cancelled: boolean,
  amountPoysha: bigint,
  owedBeforePoysha: bigint,
): boolean => cancelled && amountPoysha >= owedBeforePoysha;

/** The order row as read under its lock. Enums come back as text. */
interface LockedOrderRow {
  status: string;
  payment_method: string;
}

interface OrderOwedRow {
  cancelled: boolean;
  /** Cast to bigint in SQL; converted again in case the driver hands back text. */
  owed_poysha: bigint | string;
}

interface RefundOwedRow {
  order_id: string;
  charge_id: string;
  cancelled: boolean;
  /** Cast to bigint in SQL; converted again in case the driver hands back text. */
  owed_poysha: bigint | string;
}

/**
 * Order statuses in which a paid bKash order keeps its money: spec §6 "CONFIRMED-or-later".
 * PLACED has not been paid for yet, and CANCELLED never keeps anything.
 */
const KEPT_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PICKING,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
  OrderStatus.REFUNDED,
];

@Injectable()
export class PaymentRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(PaymentRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Writes the money movement **and** the order's summary status in one transaction.
   *
   * These cannot be two writes. An order marked PAID with no transaction row is money nobody
   * can trace; a captured row against an order still PENDING sends the customer a second
   * demand for cash they already handed over. Either both land or neither does.
   */
  async settle(
    data: RecordPaymentData,
    orderStatus: PaymentStatus | null,
  ): Promise<PaymentTransaction | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.paymentTransaction.create({
          data: {
            ...data,
            failureReason: PaymentRepository.trim(data.failureReason),
            capturedAt: data.status === PaymentTransactionStatus.CAPTURED ? new Date() : null,
          },
        });

        if (orderStatus) {
          await tx.order.update({
            where: { id: data.orderId },
            data: { paymentStatus: orderStatus },
          });
        }

        return payment;
      });
    } catch (error) {
      // A duplicate gateway reference lands here: the unique index is what makes a replayed
      // webhook harmless, so this is an expected outcome rather than a surprise.
      this.logger.error(
        { err: error, orderId: data.orderId, direction: data.direction },
        'Exception occurred in PaymentRepository.settle',
      );
      return null;
    }
  }

  /** An existing row for this gateway reference, if the webhook has already been seen. */
  async findByReference(reference: string): Promise<PaymentTransaction | null | undefined> {
    try {
      return (
        (await this.prisma.paymentTransaction.findUnique({
          where: { gatewayReference: reference },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PaymentRepository.findByReference');
      return null;
    }
  }

  /** One ledger row by its id. */
  async findById(id: string): Promise<PaymentTransaction | null | undefined> {
    try {
      return (await this.prisma.paymentTransaction.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, paymentId: id },
        'Exception occurred in PaymentRepository.findById',
      );
      return null;
    }
  }

  /**
   * Sums what an order has captured and refunded.
   *
   * Computed from the ledger rather than kept on the order, so the two can never disagree.
   * `method` narrows the sums to one payment method: staff cash and refund totals count only the
   * order's current method (ruling R16), so a bKash capture on an order switched to cash on
   * delivery neither pays for it nor can be handed back as cash. Omitted, every method counts.
   */
  async totalsForOrder(orderId: string, method?: PaymentMethod): Promise<PaymentTotals | null> {
    try {
      const rows = await this.prisma.paymentTransaction.groupBy({
        by: ['direction'],
        where: {
          orderId,
          status: PaymentTransactionStatus.CAPTURED,
          ...(method ? { method } : {}),
        },
        _sum: { amountPoysha: true },
      });

      const sumOf = (direction: PaymentDirection): bigint =>
        rows.find((row) => row.direction === direction)?._sum.amountPoysha ?? 0n;

      return {
        capturedPoysha: sumOf(PaymentDirection.CHARGE),
        refundedPoysha: sumOf(PaymentDirection.REFUND),
      };
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentRepository.totalsForOrder',
      );
      return null;
    }
  }

  /**
   * What an order's automatic bKash refunds have claimed but not yet completed. That money may
   * already be on its way back, so a staff refund nets it out rather than paying it twice.
   */
  async sumPendingRefundClaims(orderId: string): Promise<bigint | null> {
    try {
      const pending = await this.prisma.paymentTransaction.aggregate({
        where: {
          orderId,
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
        },
        _sum: { amountPoysha: true },
      });

      return pending._sum.amountPoysha ?? 0n;
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentRepository.sumPendingRefundClaims',
      );
      return null;
    }
  }

  /** The ledger for one order, oldest first: a payment history reads forwards. */
  async findForOrder(orderId: string): Promise<PaymentTransaction[] | null> {
    try {
      return await this.prisma.paymentTransaction.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentRepository.findForOrder',
      );
      return null;
    }
  }

  /** The whole ledger for staff, newest first. */
  async findPage(
    where: Prisma.PaymentTransactionWhereInput,
    skip: number,
    take: number,
  ): Promise<PaymentPage | null> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.paymentTransaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.paymentTransaction.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PaymentRepository.findPage');
      return null;
    }
  }

  /**
   * Opens a bKash attempt and stretches the order's stock hold to cover it, in one transaction.
   *
   * Only live holds that would lapse before `holdUntil` move, and only forwards: a hold that
   * already runs longer is left alone. A `paymentID` already recorded answers
   * {@link PAYMENT_DUPLICATE}.
   */
  async createAttempt(
    data: BkashAttemptData,
    holdUntil: Date,
  ): Promise<PaymentTransaction | typeof PAYMENT_DUPLICATE | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attempt = await tx.paymentTransaction.create({
          data: {
            orderId: data.orderId,
            method: PaymentMethod.BKASH,
            direction: PaymentDirection.CHARGE,
            status: PaymentTransactionStatus.PENDING,
            amountPoysha: data.amountPoysha,
            gatewayReference: data.paymentId,
          },
        });

        await tx.stockReservation.updateMany({
          where: {
            referenceType: OrderConstants.HoldReferenceType,
            referenceId: data.orderId,
            releasedAt: null,
            expiresAt: { lt: holdUntil },
          },
          data: { expiresAt: holdUntil },
        });

        return attempt;
      });
    } catch (error) {
      if (PaymentRepository.isUniqueViolation(error)) {
        this.logger.info({ orderId: data.orderId }, 'bKash attempt already recorded');
        return PAYMENT_DUPLICATE;
      }

      this.logger.error(
        { err: error, orderId: data.orderId },
        'Exception occurred in PaymentRepository.createAttempt',
      );
      return null;
    }
  }

  /** The bKash attempt bKash knows by this `paymentID`. */
  async findAttemptByPaymentId(paymentId: string): Promise<PaymentTransaction | null | undefined> {
    try {
      return (
        (await this.prisma.paymentTransaction.findFirst({
          where: {
            gatewayReference: paymentId,
            method: PaymentMethod.BKASH,
            direction: PaymentDirection.CHARGE,
          },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PaymentRepository.findAttemptByPaymentId',
      );
      return null;
    }
  }

  /**
   * The same attempt `findAttemptByPaymentId` finds, with the number of the order it pays for,
   * which is what the callback redirect quotes back to the customer.
   */
  async findAttemptWithOrderNumber(
    paymentId: string,
  ): Promise<AttemptWithOrderNumber | null | undefined> {
    try {
      const row = await this.prisma.paymentTransaction.findFirst({
        where: {
          gatewayReference: paymentId,
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
        },
        include: { order: { select: { orderNumber: true } } },
      });

      if (!row) {
        return undefined;
      }

      const { order, ...attempt } = row;
      return { attempt, orderNumber: order.orderNumber };
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PaymentRepository.findAttemptWithOrderNumber',
      );
      return null;
    }
  }

  /**
   * Ends a still-PENDING attempt without money moving.
   *
   * Conditional on PENDING, so an attempt settled by someone else is never overwritten.
   * `false` means it was no longer PENDING.
   */
  async closeAttempt(
    id: string,
    status: ClosedAttemptStatus,
    reason: string,
  ): Promise<boolean | null> {
    try {
      const closed = await this.prisma.paymentTransaction.updateMany({
        where: { id, status: PaymentTransactionStatus.PENDING },
        data: { status, failureReason: PaymentRepository.trim(reason) },
      });

      return closed.count === 1;
    } catch (error) {
      this.logger.error(
        { err: error, attemptId: id, status },
        'Exception occurred in PaymentRepository.closeAttempt',
      );
      return null;
    }
  }

  /**
   * Captures a completed attempt and, when the order can take the money, confirms it as paid.
   *
   * One transaction. The attempt moves PENDING → CAPTURED conditionally, so only one caller
   * ever gets past the first step. The order row is then locked, and the order is confirmed
   * only when it is still PLACED, still paid by bKash, and no other bKash charge was captured
   * for it. PAID is written with CONFIRMED: the reservation sweeper never cancels a PAID order.
   * Anything else commits the capture alone and answers `refund-due`.
   */
  async captureAttempt(id: string, transactionId: string): Promise<CaptureResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const captured = await tx.paymentTransaction.updateMany({
          where: {
            id,
            method: PaymentMethod.BKASH,
            direction: PaymentDirection.CHARGE,
            status: PaymentTransactionStatus.PENDING,
          },
          data: {
            status: PaymentTransactionStatus.CAPTURED,
            gatewayTransactionId: transactionId,
            capturedAt: new Date(),
          },
        });

        if (captured.count === 0) {
          return { kind: 'already-settled' } as const;
        }

        const attempt = await tx.paymentTransaction.findUniqueOrThrow({ where: { id } });
        return await PaymentRepository.confirmIfEligible(tx, attempt);
      });
    } catch (error) {
      // The trxID is unique: a second row claiming it means this payment was already recorded.
      // bKash does not reuse a trxID across payments, so that is worth a look.
      if (PaymentRepository.isUniqueViolation(error)) {
        this.logger.warn({ attemptId: id }, 'bKash transaction already recorded on another row');
        return { kind: 'already-settled' };
      }

      this.logger.error(
        { err: error, attemptId: id },
        'Exception occurred in PaymentRepository.captureAttempt',
      );
      return null;
    }
  }

  /**
   * Captures an attempt bKash completed for a different amount, currency or order (ruling R19).
   *
   * The money was taken, so the row must say so: PENDING → CAPTURED, conditionally, with the
   * trxID, the capture time and the amount **bKash reported** rather than the order total, so the
   * owed query gives back exactly what was taken. `failure_reason` marks it as a mismatch: it
   * never paid for the order, so it does not count against a later correct payment. The order is
   * never touched; the capture is left owed, which is what the automatic refund looks for.
   * `false` means the attempt was no longer PENDING.
   */
  async captureMismatched(
    id: string,
    transactionId: string,
    reportedAmountPoysha: bigint,
  ): Promise<boolean | null> {
    try {
      const captured = await this.prisma.paymentTransaction.updateMany({
        where: {
          id,
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.PENDING,
        },
        data: {
          status: PaymentTransactionStatus.CAPTURED,
          gatewayTransactionId: transactionId,
          capturedAt: new Date(),
          amountPoysha: reportedAmountPoysha,
          failureReason: PaymentConstants.AmountMismatchReason,
        },
      });

      return captured.count === 1;
    } catch (error) {
      // A trxID already on another row lands here too, at error: money was taken and this
      // attempt stays PENDING until a person looks.
      this.logger.error(
        { err: error, attemptId: id },
        'Exception occurred in PaymentRepository.captureMismatched',
      );
      return null;
    }
  }

  /**
   * Claims an automatic refund of a captured bKash charge **before** bKash is asked for it.
   *
   * Inserts a PENDING REFUND row whose `gateway_reference` is the prefix plus the charge's trxID.
   * That reference is unique, so exactly one caller can hold the claim for a charge: any other
   * pass (the inline settle refund, a sweeper, another replica) gets {@link REFUND_CLAIMED} and
   * must not call bKash. A PENDING claim moves no totals (they count CAPTURED rows), but the owed
   * query treats it as in flight. `amountPoysha` must be positive and within the charge.
   */
  async claimRefund(
    orderId: string,
    charge: PaymentTransaction,
    amountPoysha: bigint,
  ): Promise<PaymentTransaction | typeof REFUND_CLAIMED | null> {
    try {
      if (!PaymentRepository.isRefundableFrom(charge, amountPoysha)) {
        this.logger.error(
          { orderId, chargeId: charge.id },
          'Automatic refund does not fit its bKash charge',
        );
        return null;
      }

      return await this.prisma.paymentTransaction.create({
        data: {
          orderId,
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
          amountPoysha,
          gatewayReference:
            PaymentConstants.AutoRefundReferencePrefix + charge.gatewayTransactionId,
          collectedBy: null,
        },
      });
    } catch (error) {
      if (PaymentRepository.isUniqueViolation(error)) {
        this.logger.info({ orderId, chargeId: charge.id }, 'bKash refund already claimed');
        return REFUND_CLAIMED;
      }

      this.logger.error(
        { err: error, orderId, chargeId: charge.id },
        'Exception occurred in PaymentRepository.claimRefund',
      );
      return null;
    }
  }

  /**
   * Records that bKash gave the claimed money back: the claim moves PENDING → CAPTURED with
   * bKash's refund trxID (null when bKash gave none) and, when `markRefunded`, the order's payment
   * becomes REFUNDED, in one transaction. `false` means the claim was no longer PENDING.
   *
   * `audit`, when a person resolved the claim (ruling R18), is appended in the same transaction,
   * so the claim never changes without its record. A refund trxID already on another row answers
   * {@link PAYMENT_DUPLICATE}.
   */
  async completeRefund(
    claimId: string,
    refundTransactionId: string | null,
    markRefunded: boolean,
    audit?: AuditLogWriteData,
  ): Promise<boolean | typeof PAYMENT_DUPLICATE | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const completed = await tx.paymentTransaction.updateMany({
          where: {
            id: claimId,
            direction: PaymentDirection.REFUND,
            status: PaymentTransactionStatus.PENDING,
          },
          data: {
            status: PaymentTransactionStatus.CAPTURED,
            capturedAt: new Date(),
            gatewayTransactionId: refundTransactionId,
          },
        });

        if (completed.count === 0) {
          return false;
        }

        if (markRefunded) {
          const claim = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: claimId } });
          await tx.order.update({
            where: { id: claim.orderId },
            data: { paymentStatus: PaymentStatus.REFUNDED },
          });
        }

        if (audit) {
          await this.auditLog.appendWithin(tx, audit);
        }

        return true;
      });
    } catch (error) {
      if (PaymentRepository.isUniqueViolation(error)) {
        this.logger.warn({ claimId }, 'bKash refund transaction already recorded on another row');
        return PAYMENT_DUPLICATE;
      }

      this.logger.error(
        { err: error, claimId },
        'Exception occurred in PaymentRepository.completeRefund',
      );
      return null;
    }
  }

  /**
   * Gives up a claim bKash definitively refused, so a later pass may try again. Only a PENDING
   * REFUND row is ever removed; a completed refund is never deleted. `audit`, when a person
   * resolved the claim as not refunded (ruling R18), is appended in the same transaction.
   */
  async releaseRefundClaim(claimId: string, audit?: AuditLogWriteData): Promise<boolean | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const released = await tx.paymentTransaction.deleteMany({
          where: {
            id: claimId,
            direction: PaymentDirection.REFUND,
            status: PaymentTransactionStatus.PENDING,
          },
        });

        if (released.count !== 1) {
          return false;
        }

        if (audit) {
          await this.auditLog.appendWithin(tx, audit);
        }

        return true;
      });
    } catch (error) {
      this.logger.error(
        { err: error, claimId },
        'Exception occurred in PaymentRepository.releaseRefundClaim',
      );
      return null;
    }
  }

  /** bKash attempts still PENDING that were opened before `olderThan`, oldest first. */
  async findPendingAttempts(olderThan: Date, take: number): Promise<PaymentTransaction[] | null> {
    try {
      return await this.prisma.paymentTransaction.findMany({
        where: {
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.PENDING,
          createdAt: { lt: olderThan },
        },
        orderBy: { createdAt: 'asc' },
        take,
      });
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PaymentRepository.findPendingAttempts',
      );
      return null;
    }
  }

  /**
   * PENDING bKash REFUND claims opened before `olderThan`, oldest first. A claim is only ever
   * PENDING for the length of one call to bKash, so one this old was left by an ambiguous answer
   * or by a refund bKash made that could not be recorded. Money may already have moved, so these
   * are read to be reported to a person, never to be released.
   */
  async findStaleRefundClaims(olderThan: Date, take: number): Promise<PaymentTransaction[] | null> {
    try {
      return await this.prisma.paymentTransaction.findMany({
        where: {
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
          createdAt: { lt: olderThan },
        },
        orderBy: { createdAt: 'asc' },
        take,
      });
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PaymentRepository.findStaleRefundClaims',
      );
      return null;
    }
  }

  /**
   * Orders holding bKash money they have no right to keep, each with the newest captured bKash
   * charge that has not been refunded yet and how much of it to give back. Spec §6:
   *
   * ```
   * kept = order.total  if CONFIRMED-or-later, paid by BKASH and payment_status = PAID; else 0
   * owed = Σ CAPTURED BKASH charges − Σ CAPTURED BKASH refunds − kept
   * ```
   *
   * Computed in SQL so the `owed > 0` filter runs before the batch limit: every paid bKash
   * order has an unrefunded charge, and filtering after the limit would let those fill the
   * batch and starve the orders that are actually owed.
   */
  async findRefundsOwed(take: number): Promise<RefundOwed[] | null> {
    try {
      return await this.loadRefundsOwed(PaymentRepository.refundsOwedQuery(take, null));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PaymentRepository.findRefundsOwed');
      return null;
    }
  }

  /**
   * What one order is owed back right now, by the same §6 rule as {@link findRefundsOwed}:
   * its newest unrefunded captured bKash charge and how much of it to give back. Used straight
   * after a capture the order could not take, so that refund and the sweeper's agree on the
   * amount and on whether it clears the order. `undefined` means nothing is owed.
   */
  async findRefundOwedForOrder(orderId: string): Promise<RefundOwed | null | undefined> {
    try {
      const [entry] = await this.loadRefundsOwed(PaymentRepository.refundsOwedQuery(1, orderId));
      return entry;
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentRepository.findRefundOwedForOrder',
      );
      return null;
    }
  }

  /**
   * Whether one order is cancelled and what it is owed back right now, by the same §6 rule as
   * {@link findRefundsOwed}, PENDING claims netted. Read when a person resolves a claim, so the
   * claim marks the order REFUNDED exactly when the sweep would have. `undefined` means the
   * order has no bKash money at all.
   */
  async findOwedForOrder(orderId: string): Promise<OrderOwed | null | undefined> {
    try {
      const [row] = await this.prisma.$queryRaw<OrderOwedRow[]>(
        PaymentRepository.orderOwedQuery(orderId),
      );

      return row ? { cancelled: row.cancelled, owedPoysha: BigInt(row.owed_poysha) } : undefined;
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentRepository.findOwedForOrder',
      );
      return null;
    }
  }

  /** Runs an owed query and pairs each row with its charge, keeping the query's ranking. */
  private async loadRefundsOwed(query: Prisma.Sql): Promise<RefundOwed[]> {
    const rows = await this.prisma.$queryRaw<RefundOwedRow[]>(query);

    if (rows.length === 0) {
      return [];
    }

    const charges = await this.prisma.paymentTransaction.findMany({
      where: { id: { in: rows.map((row) => row.charge_id) } },
    });
    const chargeById = new Map(charges.map((charge) => [charge.id, charge]));

    return rows.flatMap((row) => {
      const charge = chargeById.get(row.charge_id);
      return charge ? [PaymentRepository.toRefundOwed(row, charge)] : [];
    });
  }

  /**
   * Refunds at most what the order is owed, so a staff refund taken by hand is never paid out
   * twice, and marks the order REFUNDED only with the refund that clears the debt.
   */
  private static toRefundOwed(row: RefundOwedRow, charge: PaymentTransaction): RefundOwed {
    const owed = BigInt(row.owed_poysha);
    const amountPoysha = owed < charge.amountPoysha ? owed : charge.amountPoysha;

    return {
      orderId: row.order_id,
      charge,
      amountPoysha,
      markRefunded: refundClearsOrder(row.cancelled, amountPoysha, owed),
    };
  }

  /** A refund row must name its charge's trxID and stay within the charge. */
  private static isRefundableFrom(charge: PaymentTransaction, amountPoysha: bigint): boolean {
    return (
      charge.gatewayTransactionId !== null &&
      amountPoysha > 0n &&
      amountPoysha <= charge.amountPoysha
    );
  }

  /**
   * The second half of a capture, under the order row lock.
   *
   * `FOR UPDATE` re-reads the latest committed row, so a concurrent cancel or a concurrent
   * capture of another attempt is seen here rather than raced.
   */
  private static async confirmIfEligible(
    tx: Prisma.TransactionClient,
    attempt: PaymentTransaction,
  ): Promise<CaptureResult> {
    const orderId = attempt.orderId;
    const refundDue = { kind: 'refund-due', orderId } as const;

    const [order] = await tx.$queryRaw<LockedOrderRow[]>`
      SELECT status::text AS status, payment_method::text AS payment_method
      FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;

    if (order?.status !== OrderStatus.PLACED || order.payment_method !== PaymentMethod.BKASH) {
      return refundDue;
    }

    const otherCaptures = await tx.paymentTransaction.count({
      where: {
        orderId,
        method: PaymentMethod.BKASH,
        direction: PaymentDirection.CHARGE,
        status: PaymentTransactionStatus.CAPTURED,
        id: { not: attempt.id },
        // A mismatched capture never paid for the order (ruling R19): it is refunded, and must
        // not stop the customer's correct payment from confirming the order.
        OR: [
          { failureReason: null },
          { failureReason: { not: PaymentConstants.AmountMismatchReason } },
        ],
      },
    });

    if (otherCaptures > 0) {
      return refundDue;
    }

    const confirmed = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PLACED },
      data: { status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID },
    });

    // Cannot miss under the row lock; checked so a surprise can never confirm half an order.
    if (confirmed.count === 0) {
      return refundDue;
    }

    await tx.orderEvent.create({
      data: {
        orderId,
        fromStatus: OrderStatus.PLACED,
        toStatus: OrderStatus.CONFIRMED,
        actorId: null,
        note: PaymentConstants.PaidByBkashNote,
      },
    });

    return {
      kind: 'confirmed',
      order: await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude }),
    };
  }

  /**
   * The §6 owed query. Enum columns are compared as text so every value is a bound parameter.
   * A charge counts as refunded when a REFUND row of any status carries the auto-refund reference
   * built from its trxID, so a PENDING claim keeps it from being chosen again; the lateral join
   * drops orders that have no such charge left. A PENDING claim is also netted as given back:
   * otherwise, while the newest charge's refund is in flight, the next-newest charge would look
   * owed and be refunded as well. `owed_poysha` is
   * cast to bigint because `SUM(bigint)` is numeric. `orderId` narrows it to one order.
   */
  private static refundsOwedQuery(take: number, orderId: string | null): Prisma.Sql {
    const onlyOrder = orderId ? Prisma.sql`AND w.order_id = ${orderId}::uuid` : Prisma.empty;

    return Prisma.sql`
      ${PaymentRepository.owingCte()}
      SELECT w.order_id::text AS order_id, newest.id::text AS charge_id, w.cancelled,
        w.owed_poysha
      FROM owing w
      JOIN LATERAL (
        SELECT c.id, c.captured_at, c.created_at
        FROM payment_transactions c
        WHERE c.order_id = w.order_id
          AND c.method::text = ${PaymentMethod.BKASH}
          AND c.direction::text = ${PaymentDirection.CHARGE}
          AND c.status::text = ${PaymentTransactionStatus.CAPTURED}
          AND c.gateway_transaction_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM payment_transactions r
            WHERE r.direction::text = ${PaymentDirection.REFUND}
              AND r.gateway_reference =
                ${PaymentConstants.AutoRefundReferencePrefix}::text || c.gateway_transaction_id
          )
        ORDER BY c.captured_at DESC, c.created_at DESC, c.id DESC
        LIMIT 1
      ) newest ON TRUE
      WHERE w.owed_poysha > 0 ${onlyOrder}
      ORDER BY newest.captured_at ASC, w.order_id
      LIMIT ${take}`;
  }

  /** The owed amount of one order, owed or not, by the same CTE as the batch query. */
  private static orderOwedQuery(orderId: string): Prisma.Sql {
    return Prisma.sql`
      ${PaymentRepository.owingCte()}
      SELECT w.cancelled, w.owed_poysha
      FROM owing w WHERE w.order_id = ${orderId}::uuid`;
  }

  /**
   * The §6 net per order (`bkash`) and what each order is owed (`owing`), shared by the batch
   * query and the one-order read so the two can never compute owed differently.
   */
  private static owingCte(): Prisma.Sql {
    return Prisma.sql`
      WITH bkash AS (
        SELECT p.order_id,
          SUM(CASE WHEN p.direction::text = ${PaymentDirection.CHARGE} THEN p.amount_poysha ELSE 0 END)
            - SUM(CASE WHEN p.direction::text = ${PaymentDirection.REFUND} THEN p.amount_poysha ELSE 0 END)
            AS net_poysha
        FROM payment_transactions p
        WHERE p.method::text = ${PaymentMethod.BKASH}
          AND (p.status::text = ${PaymentTransactionStatus.CAPTURED}
            OR (p.direction::text = ${PaymentDirection.REFUND}
              AND p.status::text = ${PaymentTransactionStatus.PENDING}))
        GROUP BY p.order_id
      )
      , owing AS (
        SELECT o.id AS order_id,
          o.status::text = ${OrderStatus.CANCELLED} AS cancelled,
          (b.net_poysha - CASE
            WHEN o.status::text IN (${Prisma.join([...KEPT_ORDER_STATUSES])})
              AND o.payment_method::text = ${PaymentMethod.BKASH}
              AND o.payment_status::text = ${PaymentStatus.PAID}
            THEN o.total_poysha ELSE 0 END)::bigint AS owed_poysha
        FROM bkash b
        JOIN orders o ON o.id = b.order_id
      )`;
  }

  private static isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCodes.UniqueConstraint
    );
  }

  /** Keeps a gateway response body out of the column. */
  private static trim(reason: string | null): string | null {
    return reason ? reason.slice(0, PaymentConstants.MaxFailureLength) : null;
  }
}

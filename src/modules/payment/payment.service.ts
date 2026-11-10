import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Money } from '../../common/money/money';
import {
  Order,
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  Prisma,
} from '../../infra/prisma/prisma-client';
import { AdminAuditActions, AdminAuditEntities } from '../admin/admin.constants';
import { AuditLogWriteData } from '../admin/audit-log.repository';
import { AuthService } from '../auth/auth.service';
import { OrderRepository } from '../order/order.repository';
import {
  PaymentConstants,
  PaymentMessages,
  PaymentTokens,
  RefundClaimOutcome,
  RefundClaimOutcomes,
} from './payment.constants';
import { PaymentGateway } from './ports/payment-gateway.port';
import {
  PAYMENT_DUPLICATE,
  PaymentRepository,
  PaymentTotals,
  refundClearsOrder,
} from './payment.repository';
import { PaymentMapper } from './payment.mapper';
import {
  CollectCashDto,
  OrderPaymentSummaryDto,
  PaymentListDto,
  PaymentQueryDto,
  PaymentTransactionDto,
  RefundClaimResolutionDto,
  RefundOrderDto,
  ResolveRefundClaimDto,
} from './dto/payment.dto';

/** Statuses at which cash may legitimately be in a rider's hand. */
const CASH_COLLECTABLE: readonly OrderStatus[] = [OrderStatus.DISPATCHED, OrderStatus.DELIVERED];

/** Who is resolving a refund claim, and the claim as it was read. */
interface ClaimResolution {
  staff: AuthenticatedUser;
  actorId: string;
  claim: PaymentTransaction;
}

/**
 * The record of money moving.
 *
 * `orders.payment_status` is a *summary* of this ledger, never a substitute for it. It is
 * written only inside the same transaction as the transaction row, so the two cannot
 * disagree — an order marked PAID with no row behind it is money nobody can trace.
 *
 * Cash on delivery is not a gateway call. A rider takes notes at a doorstep and someone
 * records it afterwards; modelling that as a charge against a provider would invent a network
 * round trip that never happens.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly orders: OrderRepository,
    private readonly authService: AuthService,
    @Inject(PaymentTokens.PaymentGateway) private readonly gateway: PaymentGateway,
    @InjectPinoLogger(PaymentService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Records cash handed over at the doorstep.
   *
   * Staff-only, and deliberately not automatic on DELIVERED: an order can be marked delivered
   * by someone who never touched the money, and inferring a payment from a status change
   * would put revenue in the books that nobody counted.
   */
  async collectCash(
    staff: AuthenticatedUser,
    orderId: string,
    dto: CollectCashDto,
  ): Promise<ServiceResponse<PaymentTransactionDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(staff);
      if (!actor.ok) {
        return actor;
      }

      const order = await this.orders.findById(orderId);
      const guard = PaymentService.guardOrder(order);
      if (guard) {
        return guard;
      }

      const eligible = PaymentService.guardCashEligible(order as Order);
      if (eligible) {
        return eligible;
      }

      // Cash rows only (ruling R16): a bKash capture on an order switched to cash on delivery is
      // the automatic refund's business, and must not make the cash look already paid.
      const totals = await this.repository.totalsForOrder(orderId, PaymentMethod.CASH_ON_DELIVERY);
      if (totals === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
      }

      const outstanding = PaymentService.outstanding(order as Order, totals);
      if (outstanding <= 0n) {
        return serviceFail(HttpStatus.CONFLICT, PaymentMessages.AlreadyPaid);
      }

      const amount = dto.amountPoysha ? BigInt(dto.amountPoysha) : outstanding;
      if (amount > outstanding) {
        return serviceFail(HttpStatus.BAD_REQUEST, PaymentMessages.AmountMismatch);
      }

      return await this.capture(order as Order, amount, actor.data, outstanding);
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentService.collectCash',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Sends money back.
   *
   * Recorded as its own REFUND row rather than by mutating the charge, so a reversed sale
   * shows both sides. Cash refunds have no gateway to call; card and wallet refunds do.
   */
  async refund(
    staff: AuthenticatedUser,
    orderId: string,
    dto: RefundOrderDto,
  ): Promise<ServiceResponse<PaymentTransactionDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(staff);
      if (!actor.ok) {
        return actor;
      }

      const order = await this.orders.findById(orderId);
      const guard = PaymentService.guardOrder(order);
      if (guard) {
        return guard;
      }

      const refundable = await this.refundable(order as Order);
      if (refundable === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
      }

      if (refundable <= 0n) {
        return serviceFail(HttpStatus.CONFLICT, PaymentMessages.NothingToRefund);
      }

      const amount = dto.amountPoysha ? BigInt(dto.amountPoysha) : refundable;
      if (amount > refundable) {
        return serviceFail(HttpStatus.BAD_REQUEST, PaymentMessages.RefundExceedsCaptured);
      }

      return await this.reverse(order as Order, amount, actor.data, refundable);
    } catch (error) {
      this.logger.error({ err: error, orderId }, 'Exception occurred in PaymentService.refund');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** What one order has taken and given back, with its ledger. */
  async summaryForOrder(orderId: string): Promise<ServiceResponse<OrderPaymentSummaryDto>> {
    try {
      const order = await this.orders.findById(orderId);
      const guard = PaymentService.guardOrder(order);
      if (guard) {
        return guard;
      }

      const [totals, rows] = await Promise.all([
        this.repository.totalsForOrder(orderId),
        this.repository.findForOrder(orderId),
      ]);

      if (totals === null || rows === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
      }

      return serviceOk(
        PaymentMapper.toSummary(
          orderId,
          (order as Order).totalPoysha,
          totals.capturedPoysha,
          totals.refundedPoysha,
          rows,
        ),
      );
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentService.summaryForOrder',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Settles an automatic bKash refund claim left PENDING (ruling R18), once a SUPER_ADMIN has
   * checked the bKash merchant portal by the charge's trxID.
   *
   * `refunded` completes the claim, marking a cancelled order REFUNDED by the same rule the sweep
   * applies; `not-refunded` releases it, so the next sweep asks bKash to refund the charge again.
   * Only a PENDING bKash REFUND row can be resolved, and every resolution is audited in the same
   * transaction as the write.
   */
  async resolveRefundClaim(
    staff: AuthenticatedUser,
    claimId: string,
    dto: ResolveRefundClaimDto,
  ): Promise<ServiceResponse<RefundClaimResolutionDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(staff);
      if (!actor.ok) {
        return actor;
      }

      const claim = await this.repository.findById(claimId);
      const refusal = PaymentService.guardRefundClaim(claim, dto);
      if (refusal) {
        return refusal;
      }

      const resolution = { staff, actorId: actor.data, claim: claim as PaymentTransaction };
      return dto.outcome === RefundClaimOutcomes.Refunded
        ? await this.completeClaim(resolution, dto.refundTransactionId ?? null)
        : await this.releaseClaim(resolution);
    } catch (error) {
      this.logger.error(
        { err: error, claimId },
        'Exception occurred in PaymentService.resolveRefundClaim',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** The whole ledger, for staff reconciliation, optionally narrowed by status and direction. */
  async list(query: PaymentQueryDto): Promise<ServiceResponse<PaymentListDto>> {
    try {
      const take = query.pageSize ?? PaymentConstants.DefaultPageSize;
      const page = query.page ?? 1;

      const result = await this.repository.findPage(
        PaymentService.listFilter(query),
        (page - 1) * take,
        take,
      );

      if (result === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
      }

      return serviceOk({
        items: result.items.map((row) => PaymentMapper.toDto(row)),
        total: result.total,
        page,
        pageSize: take,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PaymentService.list');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Only the filters given; `status=PENDING&direction=REFUND` lists stale refund claims. */
  private static listFilter(query: PaymentQueryDto): Prisma.PaymentTransactionWhereInput {
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
    };
  }

  /** Records the refund bKash made, marking the order REFUNDED when it clears what is owed. */
  private async completeClaim(
    resolution: ClaimResolution,
    refundTransactionId: string | null,
  ): Promise<ServiceResponse<RefundClaimResolutionDto>> {
    const { claim } = resolution;
    const orderRefunded = await this.claimClearsOrder(claim);

    if (orderRefunded === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    const completed = await this.repository.completeRefund(
      claim.id,
      refundTransactionId,
      orderRefunded,
      PaymentService.claimAudit(resolution, {
        outcome: RefundClaimOutcomes.Refunded,
        refundTransactionId,
        orderRefunded,
      }),
    );

    return PaymentService.resolved(completed, claim, RefundClaimOutcomes.Refunded, orderRefunded);
  }

  /** Gives the claim up, so the charge is owed again and the next sweep refunds it. */
  private async releaseClaim(
    resolution: ClaimResolution,
  ): Promise<ServiceResponse<RefundClaimResolutionDto>> {
    const released = await this.repository.releaseRefundClaim(
      resolution.claim.id,
      PaymentService.claimAudit(resolution, {
        outcome: RefundClaimOutcomes.NotRefunded,
        refundTransactionId: null,
        orderRefunded: false,
      }),
    );

    return PaymentService.resolved(
      released,
      resolution.claim,
      RefundClaimOutcomes.NotRefunded,
      false,
    );
  }

  /**
   * Whether completing this claim clears what its cancelled order is owed: the rule the sweep
   * applies when it refunds. The owed read nets this PENDING claim as already given back, so the
   * order was owed the claim's amount more before it.
   */
  private async claimClearsOrder(claim: PaymentTransaction): Promise<boolean | null> {
    const owed = await this.repository.findOwedForOrder(claim.orderId);

    if (owed === null) {
      return null;
    }

    if (owed === undefined) {
      return false;
    }

    return refundClearsOrder(
      owed.cancelled,
      claim.amountPoysha,
      owed.owedPoysha + claim.amountPoysha,
    );
  }

  /** Only a PENDING automatic bKash refund claim can be resolved; anything else is refused. */
  private static guardRefundClaim(
    claim: PaymentTransaction | null | undefined,
    dto: ResolveRefundClaimDto,
  ): ServiceResponse<never> | null {
    if (claim === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    if (
      claim === undefined ||
      claim.method !== PaymentMethod.BKASH ||
      claim.direction !== PaymentDirection.REFUND
    ) {
      return serviceFail(HttpStatus.NOT_FOUND, PaymentMessages.RefundClaimNotFound);
    }

    if (claim.status !== PaymentTransactionStatus.PENDING) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.RefundClaimAlreadyResolved);
    }

    if (dto.outcome === RefundClaimOutcomes.NotRefunded && dto.refundTransactionId) {
      return serviceFail(HttpStatus.BAD_REQUEST, PaymentMessages.RefundTransactionIdNotApplicable);
    }

    return null;
  }

  /** Turns the repository's answer to a resolve into the response. */
  private static resolved(
    written: boolean | typeof PAYMENT_DUPLICATE | null,
    claim: PaymentTransaction,
    outcome: RefundClaimOutcome,
    orderRefunded: boolean,
  ): ServiceResponse<RefundClaimResolutionDto> {
    if (written === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    if (written === PAYMENT_DUPLICATE) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.RefundTransactionIdRecorded);
    }

    if (!written) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.RefundClaimAlreadyResolved);
    }

    return serviceOk({ claimId: claim.id, orderId: claim.orderId, outcome, orderRefunded });
  }

  /** The audit row for a resolve: the claim as it was, and what the person decided. */
  private static claimAudit(
    resolution: ClaimResolution,
    after: {
      outcome: RefundClaimOutcome;
      refundTransactionId: string | null;
      orderRefunded: boolean;
    },
  ): AuditLogWriteData {
    const { staff, actorId, claim } = resolution;

    return {
      actorId,
      // Phone-only accounts carry `''`, so emptiness is what "no email" means.
      actorEmail: staff.email || null,
      actorRole: staff.role,
      action: AdminAuditActions.PaymentRefundClaimResolved,
      entityType: AdminAuditEntities.PaymentTransaction,
      entityId: claim.id,
      before: {
        status: claim.status,
        orderId: claim.orderId,
        amountPoysha: Money.toJsonNumber(claim.amountPoysha),
        gatewayReference: claim.gatewayReference,
      },
      after,
      requestId: null,
    };
  }

  /** Writes the capture and the resulting order summary status together. */
  private async capture(
    order: Order,
    amount: bigint,
    actorId: string,
    outstanding: bigint,
  ): Promise<ServiceResponse<PaymentTransactionDto>> {
    const payment = await this.repository.settle(
      {
        orderId: order.id,
        method: PaymentMethod.CASH_ON_DELIVERY,
        direction: PaymentDirection.CHARGE,
        status: PaymentTransactionStatus.CAPTURED,
        amountPoysha: amount,
        gatewayReference: null,
        collectedBy: actorId,
        failureReason: null,
      },
      // A part payment leaves the order PENDING. Marking it PAID because *some* cash arrived
      // would hide the balance from every screen that reads the summary.
      amount >= outstanding ? PaymentStatus.PAID : null,
    );

    if (payment === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    return serviceOk(PaymentMapper.toDto(payment));
  }

  /** Writes the refund row and the resulting order summary status together. */
  private async reverse(
    order: Order,
    amount: bigint,
    actorId: string,
    refundable: bigint,
  ): Promise<ServiceResponse<PaymentTransactionDto>> {
    const gatewayResult = await this.reverseAtGateway(order, amount);

    if (gatewayResult && !gatewayResult.ok) {
      return serviceFail(
        HttpStatus.BAD_GATEWAY,
        gatewayResult.failureReason ?? PaymentMessages.MethodUnsupported,
      );
    }

    const payment = await this.repository.settle(
      {
        orderId: order.id,
        method: order.paymentMethod,
        direction: PaymentDirection.REFUND,
        status: PaymentTransactionStatus.CAPTURED,
        amountPoysha: amount,
        gatewayReference: gatewayResult?.reference ?? null,
        collectedBy: order.paymentMethod === PaymentMethod.CASH_ON_DELIVERY ? actorId : null,
        failureReason: null,
      },
      // Only a full reversal changes the order's summary. A partial refund leaves it PAID,
      // because the customer did pay and most of that money is still ours.
      amount >= refundable ? PaymentStatus.REFUNDED : null,
    );

    if (payment === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    return serviceOk(PaymentMapper.toDto(payment));
  }

  /** Cash goes back by hand; anything else goes back through the gateway that took it. */
  private async reverseAtGateway(order: Order, amount: bigint) {
    if (order.paymentMethod === PaymentMethod.CASH_ON_DELIVERY) {
      return null;
    }

    const original = await this.repository.findForOrder(order.id);
    const charge = original?.find(
      (row) =>
        row.direction === PaymentDirection.CHARGE &&
        row.status === PaymentTransactionStatus.CAPTURED &&
        row.gatewayReference !== null,
    );

    if (!charge?.gatewayReference) {
      return {
        ok: false,
        reference: null,
        pending: false,
        failureReason: PaymentMessages.NothingToRefund,
      };
    }

    return await this.gateway.refund({
      amountPoysha: amount,
      originalReference: charge.gatewayReference,
      // bKash refunds name the transaction, not the payment; without it bKash refuses.
      transactionId: charge.gatewayTransactionId,
    });
  }

  /**
   * What staff may still give back: captured minus refunded, in the order's **current** method
   * only (ruling R16), minus automatic bKash refunds that are claimed but not completed. Those
   * may already have paid out, so counting them as still refundable could send the same money
   * back twice. A bKash capture on an order switched to cash on delivery is left to the
   * automatic refund: refunding it here would record cash going back for money bKash holds.
   */
  private async refundable(order: Order): Promise<bigint | null> {
    const [totals, inFlight] = await Promise.all([
      this.repository.totalsForOrder(order.id, order.paymentMethod),
      this.inFlightRefunds(order),
    ]);

    if (totals === null || inFlight === null) {
      return null;
    }

    return totals.capturedPoysha - totals.refundedPoysha - inFlight;
  }

  /** Automatic refund claims exist only for bKash, so only a bKash order nets them. */
  private async inFlightRefunds(order: Order): Promise<bigint | null> {
    if (order.paymentMethod !== PaymentMethod.BKASH) {
      return 0n;
    }

    return await this.repository.sumPendingRefundClaims(order.id);
  }

  /** Total minus what has been captured, plus anything already given back. */
  private static outstanding(order: Order, totals: PaymentTotals): bigint {
    return order.totalPoysha - totals.capturedPoysha + totals.refundedPoysha;
  }

  /** Turns the repository's three-valued result into a response, or null when the order is fine. */
  private static guardOrder(order: Order | null | undefined): ServiceResponse<never> | null {
    if (order === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
    }

    if (order === undefined) {
      return serviceFail(HttpStatus.NOT_FOUND, PaymentMessages.OrderNotFound);
    }

    return null;
  }

  /** Cash may only be recorded against a cash order that has actually gone out. */
  private static guardCashEligible(order: Order): ServiceResponse<never> | null {
    if (order.paymentMethod !== PaymentMethod.CASH_ON_DELIVERY) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.NotCashOnDelivery);
    }

    if (!CASH_COLLECTABLE.includes(order.status)) {
      return serviceFail(HttpStatus.CONFLICT, PaymentMessages.NotDeliverable);
    }

    return null;
  }
}

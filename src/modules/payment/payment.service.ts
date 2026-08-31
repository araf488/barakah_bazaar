import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import {
  Order,
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
} from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import { OrderRepository } from '../order/order.repository';
import { PaymentConstants, PaymentMessages, PaymentTokens } from './payment.constants';
import { PaymentGateway } from './ports/payment-gateway.port';
import { PaymentRepository, PaymentTotals } from './payment.repository';
import { PaymentMapper } from './payment.mapper';
import {
  CollectCashDto,
  OrderPaymentSummaryDto,
  PaymentListDto,
  PaymentQueryDto,
  PaymentTransactionDto,
  RefundOrderDto,
} from './dto/payment.dto';

/** Statuses at which cash may legitimately be in a rider's hand. */
const CASH_COLLECTABLE: readonly OrderStatus[] = [OrderStatus.DISPATCHED, OrderStatus.DELIVERED];

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

      const totals = await this.repository.totalsForOrder(orderId);
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

      const totals = await this.repository.totalsForOrder(orderId);
      if (totals === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PaymentMessages.Unavailable);
      }

      const refundable = totals.capturedPoysha - totals.refundedPoysha;
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

  /** The whole ledger, for staff reconciliation. */
  async list(query: PaymentQueryDto): Promise<ServiceResponse<PaymentListDto>> {
    try {
      const take = query.pageSize ?? PaymentConstants.DefaultPageSize;
      const page = query.page ?? 1;

      const result = await this.repository.findPage({}, (page - 1) * take, take);

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
    });
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

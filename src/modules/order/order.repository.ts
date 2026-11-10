import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  Order,
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
  Prisma,
  StockMovementReason,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { consumeFefo } from '../inventory/batch-consumption';
import { OrderConstants } from './order.constants';

export type OrderResult = Order | null | undefined;

/** The order shape every repository read returns. Exported so a settle in another module returns the same. */
export const orderInclude = {
  items: true,
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetail = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** What `transition` returns when the order was no longer in the status the caller expected. */
export const TRANSITION_STALE = 'stale' as const;

export interface OrderPage {
  items: OrderWithDetail[];
  total: number;
}

/** Everything needed to write one order, already validated and priced. */
export interface PlaceOrderData {
  userId: string;
  warehouseId: string;
  paymentMethod: Prisma.OrderCreateInput['paymentMethod'];
  address: {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    upazila: string;
    area: string | null;
    addressLine: string;
    postCode: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  customerNote: string | null;
  subtotalPoysha: bigint;
  deliveryFeePoysha: bigint;
  discountPoysha: bigint;
  totalPoysha: bigint;
  /** The promotion redeemed, if any. Recorded in the same transaction as the order. */
  promotion: { id: string; discountPoysha: bigint } | null;
  /** The delivery window booked, if the customer chose one. */
  delivery: { slotId: string; date: Date } | null;
  items: {
    variantId: string;
    sku: string;
    productNameEn: string;
    productNameBn: string;
    variantNameEn: string;
    quantity: number;
    unitPricePoysha: bigint;
    lineTotalPoysha: bigint;
  }[];
  cartId: string;
}

/**
 * Order persistence.
 *
 * Placing an order does five things that must all happen or none: allocate the order number,
 * write the order and its lines, hold the stock, record the opening event, and empty the
 * basket. A partial failure here is the worst outcome in the system — stock held for an order
 * that does not exist, or an order for stock nobody reserved.
 */
@Injectable()
export class OrderRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(OrderRepository.name) private readonly logger: PinoLogger,
  ) {}

  async place(data: PlaceOrderData): Promise<OrderWithDetail | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const orderNumber = await OrderRepository.nextOrderNumber(tx);

        const order = await tx.order.create({
          data: {
            orderNumber,
            user: { connect: { id: data.userId } },
            warehouse: { connect: { id: data.warehouseId } },
            paymentMethod: data.paymentMethod,
            ...data.address,
            customerNote: data.customerNote,
            subtotalPoysha: data.subtotalPoysha,
            deliveryFeePoysha: data.deliveryFeePoysha,
            discountPoysha: data.discountPoysha,
            totalPoysha: data.totalPoysha,
            // Written with the order, so a booked place and the order holding it cannot
            // exist apart. Capacity is counted from these rows.
            ...(data.delivery
              ? {
                  deliverySlot: { connect: { id: data.delivery.slotId } },
                  deliveryDate: data.delivery.date,
                }
              : {}),
            items: { create: data.items },
            events: { create: { toStatus: OrderStatus.PLACED } },
          },
          include: orderInclude,
        });

        // The hold, and the mirrored counter the stock screens read. Both, or neither.
        //
        // The window depends on what we are waiting for. A prepaid order is waiting on a
        // customer at a payment screen, so minutes. A COD order is waiting on staff to
        // confirm it, which can take a day — applying the payment window there would return
        // stock for a perfectly good order and then sell it twice.
        const expiresAt = OrderRepository.holdExpiry(data.paymentMethod);

        for (const item of data.items) {
          await tx.stockReservation.create({
            data: {
              warehouse: { connect: { id: data.warehouseId } },
              variant: { connect: { id: item.variantId } },
              quantity: item.quantity,
              referenceType: 'Order',
              referenceId: order.id,
              expiresAt,
            },
          });

          await tx.inventory.update({
            where: {
              warehouseId_variantId: {
                warehouseId: data.warehouseId,
                variantId: item.variantId,
              },
            },
            data: { quantityReserved: { increment: item.quantity } },
          });

          await tx.stockMovement.create({
            data: {
              warehouse: { connect: { id: data.warehouseId } },
              variant: { connect: { id: item.variantId } },
              delta: 0,
              reason: StockMovementReason.RESERVED,
              note: `Reserved for order ${orderNumber}`,
              referenceType: 'Order',
              referenceId: order.id,
            },
          });
        }

        if (data.promotion) {
          // In the order transaction on purpose. A redemption row is what enforces the usage
          // limit, so one written separately could be lost while the discount was still
          // granted — or counted against a customer whose order then failed to write.
          await tx.promotionRedemption.create({
            data: {
              promotionId: data.promotion.id,
              orderId: order.id,
              userId: data.userId,
              discountPoysha: data.promotion.discountPoysha,
            },
          });
        }

        await tx.cartItem.deleteMany({ where: { cartId: data.cartId } });

        return order;
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: data.userId },
        'Exception occurred in OrderRepository.place',
      );
      return null;
    }
  }

  /** How long this order's stock stays held, by what the order is waiting for. */
  private static holdExpiry(paymentMethod: PlaceOrderData['paymentMethod']): Date {
    const minutes =
      paymentMethod === PaymentMethod.CASH_ON_DELIVERY
        ? OrderConstants.CodHoldHours * 60
        : OrderConstants.PrepaymentHoldMinutes;

    return new Date(Date.now() + minutes * 60_000);
  }

  /**
   * Sequential and gap-tolerant: `BB-20260830-000042`.
   *
   * A sequence rather than counting rows, because two simultaneous checkouts must never be
   * handed the same number — a unique index alone would turn that race into a failed order.
   */
  private static async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    return `${OrderConstants.OrderNumberPrefix}-${day}-${String(row.nextval).padStart(6, '0')}`;
  }

  async findById(id: string): Promise<OrderWithDetail | null | undefined> {
    try {
      return (
        (await this.prisma.order.findUnique({ where: { id }, include: orderInclude })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, orderId: id },
        'Exception occurred in OrderRepository.findById',
      );
      return null;
    }
  }

  /** Scoped by owner in the predicate, so another customer's id yields nothing. */
  async findForUser(userId: string, id: string): Promise<OrderWithDetail | null | undefined> {
    try {
      return (
        (await this.prisma.order.findFirst({ where: { id, userId }, include: orderInclude })) ??
        undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId, orderId: id },
        'Exception occurred in OrderRepository.findForUser',
      );
      return null;
    }
  }

  async findPage(
    where: Prisma.OrderWhereInput,
    skip: number,
    take: number,
  ): Promise<OrderPage | null> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.order.findMany({
          where,
          include: orderInclude,
          orderBy: { placedAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.order.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderRepository.findPage');
      return null;
    }
  }

  /**
   * Moves an order, records the event, and settles the stock the move implies.
   *
   * The move is a compare-and-swap on `from`: the update only matches while the order is still
   * in the status the caller read. If something else got there first (the reservation sweeper
   * cancelling while a payment confirms, or two staff clicking at once) nothing matches, the
   * transaction does no stock, event or release work, and the caller gets
   * {@link TRANSITION_STALE} instead of a half-applied move.
   *
   * DISPATCHED is where reserved stock actually leaves the shelf: the hold is released and
   * the on-hand count drops. CANCELLED and REFUNDED release the hold without a sale. Doing
   * this anywhere but inside the status transition is how stock and orders drift apart.
   */
  async transition(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actorId: string | null,
    note: string | null,
  ): Promise<OrderWithDetail | typeof TRANSITION_STALE | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const swapped = await tx.order.updateMany({
          where: { id: orderId, status: from },
          data: {
            status: to,
            ...(to === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
            ...(to === OrderStatus.CANCELLED ? { cancelledAt: new Date() } : {}),
          },
        });

        if (swapped.count === 0) {
          return TRANSITION_STALE;
        }

        await tx.orderEvent.create({
          data: { orderId, fromStatus: from, toStatus: to, actorId, note },
        });

        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: orderInclude,
        });

        if (to === OrderStatus.DISPATCHED) {
          await OrderRepository.commitStock(tx, order);
        }

        if (to === OrderStatus.CANCELLED || to === OrderStatus.REFUNDED) {
          await OrderRepository.releaseStock(tx, order, from);
        }

        return order;
      });
    } catch (error) {
      this.logger.error(
        { err: error, orderId, from, to },
        'Exception occurred in OrderRepository.transition',
      );
      return null;
    }
  }

  /** Reserved stock becomes sold: the hold clears and on-hand falls. */
  private static async commitStock(
    tx: Prisma.TransactionClient,
    order: OrderWithDetail,
  ): Promise<void> {
    for (const item of order.items) {
      await tx.inventory.update({
        where: {
          warehouseId_variantId: {
            warehouseId: order.warehouseId,
            variantId: item.variantId,
          },
        },
        data: {
          quantityOnHand: { decrement: item.quantity },
          quantityReserved: { decrement: item.quantity },
        },
      });

      // The batches must fall with the aggregate. Decrementing only quantity_on_hand leaves
      // inventory_batches claiming stock that has been sold, and expiry picking then keeps
      // choosing batches that are already empty.
      const takes = await consumeFefo(tx, order.warehouseId, item.variantId, item.quantity);

      // One movement per batch, so a recall can answer which orders received a given batch.
      for (const take of takes) {
        await tx.stockMovement.create({
          data: {
            warehouse: { connect: { id: order.warehouseId } },
            variant: { connect: { id: item.variantId } },
            ...(take.batchId ? { batch: { connect: { id: take.batchId } } } : {}),
            delta: -take.quantity,
            reason: StockMovementReason.SALE,
            note: `Dispatched on order ${order.orderNumber}`,
            referenceType: 'Order',
            referenceId: order.id,
          },
        });
      }
    }

    await tx.stockReservation.updateMany({
      where: { referenceType: 'Order', referenceId: order.id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }

  /**
   * The hold goes back.
   *
   * Only when it was still held: an order cancelled after dispatch has already had its stock
   * decremented, so releasing a reservation that no longer exists would inflate availability.
   */
  private static async releaseStock(
    tx: Prisma.TransactionClient,
    order: OrderWithDetail,
    from: OrderStatus,
  ): Promise<void> {
    const stillHeld = from !== OrderStatus.DISPATCHED && from !== OrderStatus.DELIVERED;

    if (!stillHeld) {
      return;
    }

    for (const item of order.items) {
      await tx.inventory.update({
        where: {
          warehouseId_variantId: {
            warehouseId: order.warehouseId,
            variantId: item.variantId,
          },
        },
        data: { quantityReserved: { decrement: item.quantity } },
      });

      await tx.stockMovement.create({
        data: {
          warehouse: { connect: { id: order.warehouseId } },
          variant: { connect: { id: item.variantId } },
          delta: 0,
          reason: StockMovementReason.RELEASED,
          note: `Hold released on order ${order.orderNumber}`,
          referenceType: 'Order',
          referenceId: order.id,
        },
      });
    }

    await tx.stockReservation.updateMany({
      where: { referenceType: 'Order', referenceId: order.id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }

  /**
   * Whether the order still holds its stock: some unreleased reservation runs past now.
   * `null` means the read failed, so a caller never mistakes a fault for a lapsed hold.
   */
  async holdActive(orderId: string): Promise<boolean | null> {
    try {
      const live = await this.prisma.stockReservation.count({
        where: {
          referenceType: OrderConstants.HoldReferenceType,
          referenceId: orderId,
          releasedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      return live > 0;
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in OrderRepository.holdActive',
      );
      return null;
    }
  }

  /**
   * Whether any bKash charge on the order has been CAPTURED: money is already held for it.
   * `null` means the read failed, so a caller never mistakes a fault for "no charge".
   */
  async hasCapturedCharge(orderId: string): Promise<boolean | null> {
    try {
      const captured = await this.prisma.paymentTransaction.count({
        where: {
          orderId,
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.CAPTURED,
        },
      });

      return captured > 0;
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in OrderRepository.hasCapturedCharge',
      );
      return null;
    }
  }

  /**
   * Moves a PLACED bKash order to cash on delivery, stretches its stock hold to `holdUntil`,
   * and records the switch, in one transaction.
   *
   * The swap is conditional on the order still being a PLACED bKash order, so a payment that
   * confirmed it, a cancel, or a second switch gets {@link TRANSITION_STALE} and nothing else
   * is written. Touches only the order row, its reservations and its event: never a payment
   * attempt. A bKash attempt still open then settles through `captureAttempt`, which refunds
   * it because the order is no longer a bKash order.
   *
   * Lock order: the order row (the conditional update), then the reservations. `captureAttempt`
   * locks the attempt row and then the order row, so the two meet only on the order row and
   * cannot wait on each other in a cycle.
   */
  async switchToCod(
    orderId: string,
    holdUntil: Date,
  ): Promise<OrderWithDetail | typeof TRANSITION_STALE | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const swapped = await tx.order.updateMany({
          where: {
            id: orderId,
            status: OrderStatus.PLACED,
            paymentMethod: PaymentMethod.BKASH,
          },
          data: { paymentMethod: PaymentMethod.CASH_ON_DELIVERY },
        });

        if (swapped.count === 0) {
          return TRANSITION_STALE;
        }

        // Forwards only: a hold that already runs longer is left alone.
        await tx.stockReservation.updateMany({
          where: {
            referenceType: OrderConstants.HoldReferenceType,
            referenceId: orderId,
            releasedAt: null,
            expiresAt: { lt: holdUntil },
          },
          data: { expiresAt: holdUntil },
        });

        await tx.orderEvent.create({
          data: {
            orderId,
            fromStatus: OrderStatus.PLACED,
            toStatus: OrderStatus.PLACED,
            actorId: null,
            note: OrderConstants.SwitchedToCodNote,
          },
        });

        return await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: orderInclude,
        });
      });
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in OrderRepository.switchToCod',
      );
      return null;
    }
  }

  /**
   * Orders whose stock hold has outlived its window while the order is still open.
   *
   * Only PLACED and CONFIRMED qualify: once an order is PICKING or beyond, staff are working
   * it and the hold is doing its job however long it has been. Terminal orders have already
   * released their stock. Paid orders are excluded too: money has been taken for them.
   */
  async findExpiredHolds(): Promise<OrderWithDetail[] | null> {
    try {
      // The filters live in this query, not after it. `reference_id` is polymorphic text with no
      // foreign key, so the join needs the cast; and a paid CONFIRMED order keeps an expired,
      // unreleased hold until dispatch, so filtering after the limit would let those fill the
      // window and starve the genuinely abandoned orders behind them.
      const holds = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT o.id
        FROM stock_reservations r
        JOIN orders o ON o.id::text = r.reference_id
        WHERE r.reference_type = 'Order'
          AND r.released_at IS NULL
          AND r.expires_at < ${new Date()}
          AND o.status IN ('PLACED', 'CONFIRMED')
          AND o.payment_status <> 'PAID'
        GROUP BY o.id
        ORDER BY MIN(r.expires_at), o.id
        LIMIT ${OrderConstants.ExpiredHoldBatchSize}`;

      if (holds.length === 0) {
        return [];
      }

      return await this.prisma.order.findMany({
        where: {
          id: { in: holds.map((hold) => hold.id) },
          status: { in: [OrderStatus.PLACED, OrderStatus.CONFIRMED] },
          // A paid order is never abandoned. Cancelling it here would release the stock and
          // keep the customer's money, and nothing downstream would refund it.
          paymentStatus: { not: PaymentStatus.PAID },
        },
        include: orderInclude,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderRepository.findExpiredHolds');
      return null;
    }
  }
}

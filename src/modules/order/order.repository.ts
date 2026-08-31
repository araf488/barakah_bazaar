import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  Order,
  OrderStatus,
  PaymentMethod,
  Prisma,
  StockMovementReason,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OrderConstants } from './order.constants';

export type OrderResult = Order | null | undefined;

const orderInclude = {
  items: true,
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetail = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

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
  ): Promise<OrderWithDetail | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.update({
          where: { id: orderId },
          data: {
            status: to,
            ...(to === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
            ...(to === OrderStatus.CANCELLED ? { cancelledAt: new Date() } : {}),
            events: { create: { fromStatus: from, toStatus: to, actorId, note } },
          },
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

      await tx.stockMovement.create({
        data: {
          warehouse: { connect: { id: order.warehouseId } },
          variant: { connect: { id: item.variantId } },
          delta: -item.quantity,
          reason: StockMovementReason.SALE,
          note: `Dispatched on order ${order.orderNumber}`,
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
   * Orders whose stock hold has outlived its window while the order is still open.
   *
   * Only PLACED and CONFIRMED qualify: once an order is PICKING or beyond, staff are working
   * it and the hold is doing its job however long it has been. Terminal orders have already
   * released their stock.
   */
  async findExpiredHolds(): Promise<OrderWithDetail[] | null> {
    try {
      const holds = await this.prisma.stockReservation.findMany({
        where: { releasedAt: null, expiresAt: { lt: new Date() }, referenceType: 'Order' },
        select: { referenceId: true },
        distinct: ['referenceId'],
        take: 100,
      });

      if (holds.length === 0) {
        return [];
      }

      return await this.prisma.order.findMany({
        where: {
          id: { in: holds.map((hold) => hold.referenceId) },
          status: { in: [OrderStatus.PLACED, OrderStatus.CONFIRMED] },
        },
        include: orderInclude,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderRepository.findExpiredHolds');
      return null;
    }
  }
}

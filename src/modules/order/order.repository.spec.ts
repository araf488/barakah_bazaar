import { PinoLogger } from 'nestjs-pino';
import { OrderStatus, PaymentMethod } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { OrderRepository, PlaceOrderData } from './order.repository';

const placement = (overrides: Partial<PlaceOrderData> = {}): PlaceOrderData => ({
  userId: 'user-1',
  cartId: 'cart-1',
  warehouseId: 'wh-1',
  paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
  address: {
    recipientName: 'Rahim',
    phone: '+8801712345678',
    division: 'Dhaka',
    district: 'Dhaka',
    upazila: 'Savar',
    area: null,
    addressLine: 'House 12',
    postCode: null,
    latitude: null,
    longitude: null,
  },
  customerNote: null,
  subtotalPoysha: 250000n,
  deliveryFeePoysha: 0n,
  discountPoysha: 0n,
  totalPoysha: 250000n,
  promotion: null,
  delivery: null,
  items: [
    {
      variantId: 'var-1',
      sku: 'ALM-500',
      productNameEn: 'Almonds',
      productNameBn: 'কাঠবাদাম',
      variantNameEn: '500g',
      quantity: 2,
      unitPricePoysha: 125000n,
      lineTotalPoysha: 250000n,
    },
  ],
  ...overrides,
});

describe('OrderRepository', () => {
  let tx: {
    order: { create: jest.Mock; update: jest.Mock };
    stockReservation: { create: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
    promotionRedemption: { create: jest.Mock };
    inventoryBatch: { findMany: jest.Mock; update: jest.Mock };
    inventory: { update: jest.Mock };
    stockMovement: { create: jest.Mock };
    cartItem: { deleteMany: jest.Mock };
    $queryRaw: jest.Mock;
    $queryRawUnsafe: jest.Mock;
  };
  let prisma: {
    $transaction: jest.Mock;
    order: { findMany: jest.Mock };
    stockReservation: { findMany: jest.Mock };
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: OrderRepository;

  beforeEach(() => {
    tx = {
      order: {
        create: jest.fn().mockResolvedValue({ id: 'ord-1' }),
        update: jest.fn(),
      },
      stockReservation: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      promotionRedemption: { create: jest.fn() },
      inventoryBatch: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      inventory: { update: jest.fn() },
      stockMovement: { create: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
    };
    prisma = {
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
      order: { findMany: jest.fn() },
      stockReservation: { findMany: jest.fn() },
    };
    logger = createMockLogger();
    repository = new OrderRepository(prisma as unknown as PrismaService, logger);
  });

  const heldMinutes = (): number => {
    const { expiresAt } = tx.stockReservation.create.mock.calls[0][0].data as {
      expiresAt: Date;
    };

    return Math.round((expiresAt.getTime() - Date.now()) / 60_000);
  };

  describe('place — how long stock stays held', () => {
    it('holds cash-on-delivery stock for a week, because staff confirm it, not a payment screen', async () => {
      await repository.place(placement({ paymentMethod: PaymentMethod.CASH_ON_DELIVERY }));

      expect(heldMinutes()).toBe(168 * 60);
    });

    it('holds prepaid stock for half an hour, because the customer is at a payment screen', async () => {
      await repository.place(placement({ paymentMethod: PaymentMethod.BKASH }));

      expect(heldMinutes()).toBe(30);
    });

    it('gives every line of one order the same expiry', async () => {
      await repository.place(
        placement({
          items: [
            { ...placement().items[0] },
            { ...placement().items[0], variantId: 'var-2', sku: 'CSH-500' },
          ],
        }),
      );

      const [first, second] = tx.stockReservation.create.mock.calls.map(
        (call) => (call[0].data as { expiresAt: Date }).expiresAt,
      );

      expect(first).toEqual(second);
    });
  });

  describe('place — recording a redemption', () => {
    it('writes the redemption inside the order transaction', async () => {
      await repository.place(placement({ promotion: { id: 'promo-1', discountPoysha: 25000n } }));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.promotionRedemption.create).toHaveBeenCalledWith({
        data: {
          promotionId: 'promo-1',
          orderId: 'ord-1',
          userId: 'user-1',
          discountPoysha: 25000n,
        },
      });
    });

    it('records nothing when no promo code was used', async () => {
      await repository.place(placement());

      expect(tx.promotionRedemption.create).not.toHaveBeenCalled();
    });

    it('snapshots what the redemption was worth, not the promotion terms', async () => {
      await repository.place(placement({ promotion: { id: 'promo-1', discountPoysha: 12345n } }));

      expect(tx.promotionRedemption.create.mock.calls[0][0].data.discountPoysha).toBe(12345n);
    });
  });

  describe('transition to DISPATCHED — settling stock', () => {
    const dispatched = (items = [{ variantId: 'var-1', quantity: 5 }]) => ({
      id: 'ord-1',
      orderNumber: 'BB-20260831-000001',
      warehouseId: 'wh-1',
      items,
    });

    beforeEach(() => {
      tx.order.update.mockResolvedValue(dispatched());
    });

    it('decrements the batches, not only the aggregate on-hand', async () => {
      // Without this the two diverge on every sale and expiry picking keeps choosing
      // batches that have already been sold.
      tx.inventoryBatch.findMany.mockResolvedValue([{ id: 'b1', quantity: 10 }]);

      await repository.transition('ord-1', OrderStatus.PICKING, OrderStatus.DISPATCHED, null, null);

      expect(tx.inventory.update).toHaveBeenCalled();
      expect(tx.inventoryBatch.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { quantity: { decrement: 5 } },
      });
    });

    it('takes from the earliest-expiring batch first', async () => {
      tx.inventoryBatch.findMany.mockResolvedValue([
        { id: 'expiring-soon', quantity: 3 },
        { id: 'expiring-later', quantity: 10 },
      ]);

      await repository.transition('ord-1', OrderStatus.PICKING, OrderStatus.DISPATCHED, null, null);

      const updates = tx.inventoryBatch.update.mock.calls.map(
        (call): unknown => call[0] as unknown,
      );

      expect(updates).toEqual([
        { where: { id: 'expiring-soon' }, data: { quantity: { decrement: 3 } } },
        { where: { id: 'expiring-later' }, data: { quantity: { decrement: 2 } } },
      ]);
    });

    it('names the batch on every movement, so a recall can trace the order', async () => {
      tx.inventoryBatch.findMany.mockResolvedValue([{ id: 'b1', quantity: 10 }]);

      await repository.transition('ord-1', OrderStatus.PICKING, OrderStatus.DISPATCHED, null, null);

      expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({
        batch: { connect: { id: 'b1' } },
        delta: -5,
        referenceType: 'Order',
        referenceId: 'ord-1',
      });
    });

    it('writes one movement per batch when a line spans two', async () => {
      tx.inventoryBatch.findMany.mockResolvedValue([
        { id: 'b1', quantity: 3 },
        { id: 'b2', quantity: 10 },
      ]);

      await repository.transition('ord-1', OrderStatus.PICKING, OrderStatus.DISPATCHED, null, null);

      const deltas = tx.stockMovement.create.mock.calls.map(
        (call) => (call[0].data as { delta: number }).delta,
      );

      // Still sums to the five units that left, but each row names its batch.
      expect(deltas).toEqual([-3, -2]);
      expect(deltas.reduce((total, delta) => total + delta, 0)).toBe(-5);
    });

    it('still records the movement for a variant with no batches', async () => {
      tx.inventoryBatch.findMany.mockResolvedValue([]);

      await repository.transition('ord-1', OrderStatus.PICKING, OrderStatus.DISPATCHED, null, null);

      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
      expect(tx.stockMovement.create.mock.calls[0][0].data).not.toHaveProperty('batch');
      expect(tx.stockMovement.create.mock.calls[0][0].data.delta).toBe(-5);
    });

    it('settles every line of a multi-line order', async () => {
      tx.order.update.mockResolvedValue(
        dispatched([
          { variantId: 'var-1', quantity: 2 },
          { variantId: 'var-2', quantity: 3 },
        ]),
      );

      await repository.transition('ord-1', OrderStatus.PICKING, OrderStatus.DISPATCHED, null, null);

      expect(tx.inventory.update).toHaveBeenCalledTimes(2);
      expect(tx.inventoryBatch.findMany).toHaveBeenCalledTimes(2);
    });

    it('does all of it inside the one transition transaction', async () => {
      tx.inventoryBatch.findMany.mockResolvedValue([{ id: 'b1', quantity: 10 }]);

      await repository.transition('ord-1', OrderStatus.PICKING, OrderStatus.DISPATCHED, null, null);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('findExpiredHolds', () => {
    it('asks only for live holds that are already past their expiry', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([]);

      await repository.findExpiredHolds();

      const where = prisma.stockReservation.findMany.mock.calls[0][0].where as {
        releasedAt: null;
        expiresAt: { lt: Date };
        referenceType: string;
      };

      expect(where.releasedAt).toBeNull();
      expect(where.referenceType).toBe('Order');
      expect(where.expiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('returns only orders still open, so a picked or dispatched order keeps its stock', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([{ referenceId: 'ord-1' }]);
      prisma.order.findMany.mockResolvedValue([{ id: 'ord-1' }]);

      await repository.findExpiredHolds();

      expect(prisma.order.findMany.mock.calls[0][0].where.status).toEqual({
        in: [OrderStatus.PLACED, OrderStatus.CONFIRMED],
      });
    });

    it('does not query orders at all when nothing has expired', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([]);

      await expect(repository.findExpiredHolds()).resolves.toEqual([]);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('collapses many holds on one order into a single order lookup', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([{ referenceId: 'ord-1' }]);
      prisma.order.findMany.mockResolvedValue([]);

      await repository.findExpiredHolds();

      expect(prisma.stockReservation.findMany.mock.calls[0][0].distinct).toEqual(['referenceId']);
    });

    it('returns null rather than an empty list when the read fails', async () => {
      prisma.stockReservation.findMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findExpiredHolds()).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

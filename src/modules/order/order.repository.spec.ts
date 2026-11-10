import { PinoLogger } from 'nestjs-pino';
import { OrderStatus, PaymentMethod, PaymentStatus } from '../../infra/prisma/prisma-client';
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
    order: {
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    orderEvent: { create: jest.Mock };
    paymentTransaction: { create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
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
    stockReservation: { count: jest.Mock };
    paymentTransaction: { count: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: OrderRepository;

  beforeEach(() => {
    tx = {
      order: {
        create: jest.fn().mockResolvedValue({ id: 'ord-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      orderEvent: { create: jest.fn() },
      paymentTransaction: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
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
      stockReservation: { count: jest.fn() },
      paymentTransaction: { count: jest.fn() },
      $queryRaw: jest.fn(),
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
      tx.order.findUniqueOrThrow.mockResolvedValue(dispatched());
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
      tx.order.findUniqueOrThrow.mockResolvedValue(
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

  describe('transition — compare-and-swap on the from status', () => {
    const cancelled = {
      id: 'ord-1',
      orderNumber: 'BB-20260831-000001',
      warehouseId: 'wh-1',
      items: [{ variantId: 'var-1', quantity: 5 }],
    };

    it('only moves the order while it is still in the status the caller saw', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue(cancelled);

      await repository.transition(
        'ord-1',
        OrderStatus.PLACED,
        OrderStatus.CONFIRMED,
        'user-1',
        'ok',
      );

      expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.order.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 'ord-1', status: OrderStatus.PLACED },
        data: { status: OrderStatus.CONFIRMED },
      });
    });

    it('records the event and returns the order with its detail once the swap wins', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue(cancelled);

      const result = await repository.transition(
        'ord-1',
        OrderStatus.PLACED,
        OrderStatus.CONFIRMED,
        'user-1',
        'ok',
      );

      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: 'ord-1',
          fromStatus: OrderStatus.PLACED,
          toStatus: OrderStatus.CONFIRMED,
          actorId: 'user-1',
          note: 'ok',
        },
      });
      expect(tx.order.findUniqueOrThrow.mock.calls[0][0]).toMatchObject({
        where: { id: 'ord-1' },
      });
      expect(result).toBe(cancelled);
    });

    it('reports stale when another writer already moved the order', async () => {
      tx.order.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.transition(
        'ord-1',
        OrderStatus.PLACED,
        OrderStatus.CANCELLED,
        null,
        null,
      );

      expect(result).toBe('stale');
    });

    it.each([OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.DISPATCHED])(
      'changes nothing when the swap loses, even for a move to %s',
      async (to) => {
        tx.order.updateMany.mockResolvedValue({ count: 0 });

        await repository.transition('ord-1', OrderStatus.PICKING, to, null, null);

        expect(tx.orderEvent.create).not.toHaveBeenCalled();
        expect(tx.order.findUniqueOrThrow).not.toHaveBeenCalled();
        expect(tx.inventory.update).not.toHaveBeenCalled();
        expect(tx.inventoryBatch.update).not.toHaveBeenCalled();
        expect(tx.stockMovement.create).not.toHaveBeenCalled();
        expect(tx.stockReservation.updateMany).not.toHaveBeenCalled();
      },
    );

    it('still releases the hold when a cancel wins the swap', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue(cancelled);

      await repository.transition('ord-1', OrderStatus.PLACED, OrderStatus.CANCELLED, null, null);

      expect(tx.inventory.update).toHaveBeenCalledTimes(1);
      expect(tx.stockReservation.updateMany).toHaveBeenCalledTimes(1);
    });

    it('returns null and logs when the transaction throws', async () => {
      tx.order.updateMany.mockRejectedValue(new Error('connection reset'));

      const result = await repository.transition(
        'ord-1',
        OrderStatus.PLACED,
        OrderStatus.CONFIRMED,
        null,
        null,
      );

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('findExpiredHolds', () => {
    /** The text of the one raw query, with its bound values shown as `?`. */
    const holdSql = (): string => {
      const strings = prisma.$queryRaw.mock.calls[0][0] as string[];

      return strings.join('?').replace(/\s+/g, ' ');
    };

    it('asks only for live holds that are already past their expiry', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findExpiredHolds();

      const expiry = prisma.$queryRaw.mock.calls[0][1] as Date;

      expect(holdSql()).toContain("r.reference_type = 'Order'");
      expect(holdSql()).toContain('r.released_at IS NULL');
      expect(holdSql()).toContain('r.expires_at < ?');
      expect(expiry.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('joins reservations to orders, so the order filters apply before the limit', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findExpiredHolds();

      expect(holdSql()).toContain(
        'FROM stock_reservations r JOIN orders o ON o.id::text = r.reference_id',
      );
      expect(holdSql()).toContain("o.status IN ('PLACED', 'CONFIRMED')");
      expect(holdSql()).toContain("o.payment_status <> 'PAID'");
    });

    it('takes the oldest holds first and caps the batch at 100', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findExpiredHolds();

      expect(holdSql()).toContain('GROUP BY o.id ORDER BY MIN(r.expires_at), o.id LIMIT ?');
      expect(prisma.$queryRaw.mock.calls[0][2]).toBe(100);
    });

    it('returns only orders still open, so a picked or dispatched order keeps its stock', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'ord-1' }]);
      prisma.order.findMany.mockResolvedValue([{ id: 'ord-1' }]);

      await repository.findExpiredHolds();

      expect(prisma.order.findMany.mock.calls[0][0].where.status).toEqual({
        in: [OrderStatus.PLACED, OrderStatus.CONFIRMED],
      });
    });

    it('never offers a paid order, so the sweep cannot cancel money it has taken', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'ord-1' }]);
      prisma.order.findMany.mockResolvedValue([]);

      await repository.findExpiredHolds();

      expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['ord-1'] },
        status: { in: [OrderStatus.PLACED, OrderStatus.CONFIRMED] },
        paymentStatus: { not: PaymentStatus.PAID },
      });
    });

    it('returns the abandoned orders the query selected', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'ord-1' }, { id: 'ord-2' }]);
      prisma.order.findMany.mockResolvedValue([{ id: 'ord-1' }, { id: 'ord-2' }]);

      await expect(repository.findExpiredHolds()).resolves.toEqual([
        { id: 'ord-1' },
        { id: 'ord-2' },
      ]);
      expect(prisma.order.findMany.mock.calls[0][0].where.id).toEqual({ in: ['ord-1', 'ord-2'] });
    });

    it('does not query orders at all when nothing has expired', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(repository.findExpiredHolds()).resolves.toEqual([]);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('returns null rather than an empty list when the read fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findExpiredHolds()).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('holdActive', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-17T10:00:00.000Z') });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("counts only the order's unreleased holds that run past now", async () => {
      prisma.stockReservation.count.mockResolvedValue(2);

      await expect(repository.holdActive('ord-1')).resolves.toBe(true);
      expect(prisma.stockReservation.count).toHaveBeenCalledWith({
        where: {
          referenceType: 'Order',
          referenceId: 'ord-1',
          releasedAt: null,
          expiresAt: { gt: new Date('2026-10-17T10:00:00.000Z') },
        },
      });
    });

    it('answers false when every hold has lapsed or been released', async () => {
      prisma.stockReservation.count.mockResolvedValue(0);

      await expect(repository.holdActive('ord-1')).resolves.toBe(false);
    });

    it('answers null rather than false when the read fails', async () => {
      prisma.stockReservation.count.mockRejectedValue(new Error('connection reset'));

      await expect(repository.holdActive('ord-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        'Exception occurred in OrderRepository.holdActive',
      );
    });
  });

  describe('switchToCod', () => {
    const holdUntil = new Date('2026-10-24T10:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-17T10:00:00.000Z') });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('swaps the method only while the order is still a PLACED bKash order', async () => {
      await repository.switchToCod('ord-1', holdUntil);

      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'ord-1', status: OrderStatus.PLACED, paymentMethod: PaymentMethod.BKASH },
        data: { paymentMethod: PaymentMethod.CASH_ON_DELIVERY },
      });
    });

    it('answers stale and writes nothing else when the swap matched no row', async () => {
      tx.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.switchToCod('ord-1', holdUntil)).resolves.toBe('stale');
      expect(tx.stockReservation.updateMany).not.toHaveBeenCalled();
      expect(tx.orderEvent.create).not.toHaveBeenCalled();
      expect(tx.order.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("extends the order's unreleased holds forwards to the new deadline", async () => {
      await repository.switchToCod('ord-1', holdUntil);

      expect(tx.stockReservation.updateMany).toHaveBeenCalledWith({
        where: {
          referenceType: 'Order',
          referenceId: 'ord-1',
          releasedAt: null,
          expiresAt: { lt: holdUntil },
        },
        data: { expiresAt: holdUntil },
      });
    });

    it('records the switch as an event that keeps the status PLACED', async () => {
      await repository.switchToCod('ord-1', holdUntil);

      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: 'ord-1',
          fromStatus: OrderStatus.PLACED,
          toStatus: OrderStatus.PLACED,
          actorId: null,
          note: 'Customer switched to cash on delivery.',
        },
      });
    });

    it('returns the order with its lines and history, read after the event is written', async () => {
      const switched = { id: 'ord-1', paymentMethod: PaymentMethod.CASH_ON_DELIVERY };
      tx.order.findUniqueOrThrow.mockResolvedValue(switched);

      await expect(repository.switchToCod('ord-1', holdUntil)).resolves.toBe(switched);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.order.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'ord-1' },
        include: { items: true, events: { orderBy: { createdAt: 'asc' } } },
      });
      expect(tx.orderEvent.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.order.findUniqueOrThrow.mock.invocationCallOrder[0],
      );
    });

    it('never writes a payment attempt row', async () => {
      await repository.switchToCod('ord-1', holdUntil);

      expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
      expect(tx.paymentTransaction.update).not.toHaveBeenCalled();
      expect(tx.paymentTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('answers null and logs when the transaction fails', async () => {
      tx.stockReservation.updateMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.switchToCod('ord-1', holdUntil)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'Exception occurred in OrderRepository.switchToCod',
      );
    });
  });

  describe('hasCapturedCharge', () => {
    it('looks for a CAPTURED bKash charge on the order', async () => {
      prisma.paymentTransaction.count.mockResolvedValue(1);

      await expect(repository.hasCapturedCharge('ord-1')).resolves.toBe(true);
      expect(prisma.paymentTransaction.count).toHaveBeenCalledWith({
        where: {
          orderId: 'ord-1',
          method: PaymentMethod.BKASH,
          direction: 'CHARGE',
          status: 'CAPTURED',
        },
      });
    });

    it('answers false when none exists', async () => {
      prisma.paymentTransaction.count.mockResolvedValue(0);

      await expect(repository.hasCapturedCharge('ord-1')).resolves.toBe(false);
    });

    it('answers null rather than false when the read fails', async () => {
      prisma.paymentTransaction.count.mockRejectedValue(new Error('connection reset'));

      await expect(repository.hasCapturedCharge('ord-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'Exception occurred in OrderRepository.hasCapturedCharge',
      );
    });
  });
});

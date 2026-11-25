import {
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentTransactionStatus,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { PaymentRepository } from '../payment/payment.repository';
import { OrderRepository } from './order.repository';

/**
 * Review Focus 5, with the real rules on both sides. One in-memory order row is shared by the
 * real `OrderRepository.switchToCod` and the real `PaymentRepository.captureAttempt`; neither
 * is stubbed, so the test fails if either side's eligibility condition changes.
 */
describe('a bKash attempt that completes after the order switched to cash on delivery', () => {
  const holdUntil = new Date('2026-10-24T10:00:00.000Z');

  let row: { status: OrderStatus; paymentMethod: PaymentMethod };
  let orderRepository: OrderRepository;
  let paymentRepository: PaymentRepository;
  let chargeUpdates: jest.Mock;
  let confirmations: jest.Mock;

  /** Applies a Prisma `where` of plain equality terms to the shared row. */
  const matches = (where: Record<string, unknown>): boolean =>
    Object.entries(where)
      .filter(([key]) => key !== 'id')
      .every(([key, value]) => (row as Record<string, unknown>)[key] === value);

  beforeEach(() => {
    row = { status: OrderStatus.PLACED, paymentMethod: PaymentMethod.BKASH };
    chargeUpdates = jest.fn();
    confirmations = jest.fn();

    const orderTx = {
      order: {
        updateMany: jest.fn(({ where, data }: { where: Record<string, unknown>; data: object }) => {
          if (!matches(where)) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: 'ord-1', ...row })),
      },
      stockReservation: { updateMany: jest.fn() },
      orderEvent: { create: jest.fn() },
    };

    const paymentTx = {
      paymentTransaction: {
        updateMany: jest.fn((args: unknown) => {
          chargeUpdates(args);
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'pay-1', orderId: 'ord-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn(() =>
        Promise.resolve([{ status: row.status, payment_method: row.paymentMethod }]),
      ),
      order: {
        updateMany: jest.fn((args: unknown) => {
          confirmations(args);
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ord-1' }),
      },
      orderEvent: { create: jest.fn() },
    };

    const transactionOver =
      (tx: object) =>
      (fn: (client: object) => unknown): unknown =>
        fn(tx);

    orderRepository = new OrderRepository(
      { $transaction: jest.fn(transactionOver(orderTx)) } as unknown as PrismaService,
      createMockLogger(),
    );
    paymentRepository = new PaymentRepository(
      { $transaction: jest.fn(transactionOver(paymentTx)) } as unknown as PrismaService,
      { appendWithin: jest.fn() } as unknown as AuditLogRepository,
      createMockLogger(),
    );
  });

  it('is captured, then answered refund-due: the order stays cash on delivery and PLACED', async () => {
    await orderRepository.switchToCod('ord-1', holdUntil);
    expect(row.paymentMethod).toBe(PaymentMethod.CASH_ON_DELIVERY);

    await expect(paymentRepository.captureAttempt('pay-1', 'TRX1')).resolves.toEqual({
      kind: 'refund-due',
      orderId: 'ord-1',
    });

    expect(chargeUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.PENDING,
        }) as object,
      }),
    );
    expect(confirmations).not.toHaveBeenCalled();
    expect(row).toEqual({
      status: OrderStatus.PLACED,
      paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
    });
  });

  it('has the switch answer stale when the payment confirmed the order first', async () => {
    row = { status: OrderStatus.CONFIRMED, paymentMethod: PaymentMethod.BKASH };

    await expect(orderRepository.switchToCod('ord-1', holdUntil)).resolves.toBe('stale');
    expect(row.paymentMethod).toBe(PaymentMethod.BKASH);
  });
});

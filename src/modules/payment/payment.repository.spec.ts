import { PinoLogger } from 'nestjs-pino';
import {
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { PaymentRepository, RecordPaymentData } from './payment.repository';

const captureData = (overrides: Partial<RecordPaymentData> = {}): RecordPaymentData => ({
  orderId: 'ord-1',
  method: PaymentMethod.CASH_ON_DELIVERY,
  direction: PaymentDirection.CHARGE,
  status: PaymentTransactionStatus.CAPTURED,
  amountPoysha: 250000n,
  gatewayReference: null,
  collectedBy: 'user-1',
  failureReason: null,
  ...overrides,
});

describe('PaymentRepository', () => {
  let tx: {
    paymentTransaction: { create: jest.Mock };
    order: { update: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    paymentTransaction: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: PaymentRepository;

  beforeEach(() => {
    tx = {
      paymentTransaction: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }) },
      order: { update: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
      paymentTransaction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    logger = createMockLogger();
    repository = new PaymentRepository(prisma as unknown as PrismaService, logger);
  });

  describe('settle', () => {
    it('writes the money row and the order summary in one transaction', async () => {
      await repository.settle(captureData(), PaymentStatus.PAID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.paymentTransaction.create).toHaveBeenCalled();
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-1' },
        data: { paymentStatus: PaymentStatus.PAID },
      });
    });

    it('leaves the order summary alone when no new status was decided', async () => {
      await repository.settle(captureData(), null);

      expect(tx.paymentTransaction.create).toHaveBeenCalled();
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('stamps the capture time only on a captured row', async () => {
      await repository.settle(captureData(), null);

      expect(
        (tx.paymentTransaction.create.mock.calls[0][0] as { data: { capturedAt: Date | null } })
          .data.capturedAt,
      ).toBeInstanceOf(Date);
    });

    it('leaves the capture time null on a failed attempt', async () => {
      await repository.settle(captureData({ status: PaymentTransactionStatus.FAILED }), null);

      expect(
        (tx.paymentTransaction.create.mock.calls[0][0] as { data: { capturedAt: Date | null } })
          .data.capturedAt,
      ).toBeNull();
    });

    it('truncates the failure text so a gateway response body cannot land in the column', async () => {
      await repository.settle(captureData({ failureReason: 'x'.repeat(900) }), null);

      expect(
        (tx.paymentTransaction.create.mock.calls[0][0] as { data: { failureReason: string } }).data
          .failureReason,
      ).toHaveLength(500);
    });

    it('returns null rather than throwing when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('duplicate key'));

      await expect(repository.settle(captureData(), PaymentStatus.PAID)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('totalsForOrder', () => {
    it('sums captured charges and refunds separately', async () => {
      prisma.paymentTransaction.groupBy.mockResolvedValue([
        { direction: PaymentDirection.CHARGE, _sum: { amountPoysha: 250000n } },
        { direction: PaymentDirection.REFUND, _sum: { amountPoysha: 50000n } },
      ]);

      await expect(repository.totalsForOrder('ord-1')).resolves.toEqual({
        capturedPoysha: 250000n,
        refundedPoysha: 50000n,
      });
    });

    it('counts only captured rows, so a failed attempt is not revenue', async () => {
      prisma.paymentTransaction.groupBy.mockResolvedValue([]);

      await repository.totalsForOrder('ord-1');

      expect(prisma.paymentTransaction.groupBy.mock.calls[0][0].where).toEqual({
        orderId: 'ord-1',
        status: PaymentTransactionStatus.CAPTURED,
      });
    });

    it('reports zero rather than undefined for a direction with no rows', async () => {
      prisma.paymentTransaction.groupBy.mockResolvedValue([
        { direction: PaymentDirection.CHARGE, _sum: { amountPoysha: 250000n } },
      ]);

      await expect(repository.totalsForOrder('ord-1')).resolves.toEqual({
        capturedPoysha: 250000n,
        refundedPoysha: 0n,
      });
    });

    it('returns null when the sum cannot be read', async () => {
      prisma.paymentTransaction.groupBy.mockRejectedValue(new Error('connection reset'));

      await expect(repository.totalsForOrder('ord-1')).resolves.toBeNull();
    });
  });

  describe('findByReference', () => {
    it('returns undefined for a reference never seen, distinct from a failed read', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue(null);

      await expect(repository.findByReference('trx-1')).resolves.toBeUndefined();
    });

    it('returns null when the lookup itself fails', async () => {
      prisma.paymentTransaction.findUnique.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findByReference('trx-1')).resolves.toBeNull();
    });
  });

  describe('findForOrder', () => {
    it('reads a payment history forwards, oldest first', async () => {
      prisma.paymentTransaction.findMany.mockResolvedValue([]);

      await repository.findForOrder('ord-1');

      expect(prisma.paymentTransaction.findMany.mock.calls[0][0].orderBy).toEqual({
        createdAt: 'asc',
      });
    });

    it('returns null when the ledger cannot be read', async () => {
      prisma.paymentTransaction.findMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findForOrder('ord-1')).resolves.toBeNull();
    });
  });

  describe('findPage', () => {
    it('returns the page and the count taken with the same filter', async () => {
      prisma.paymentTransaction.findMany.mockResolvedValue([{ id: 'pay-1' }]);
      prisma.paymentTransaction.count.mockResolvedValue(1);

      await expect(repository.findPage({}, 0, 20)).resolves.toEqual({
        items: [{ id: 'pay-1' }],
        total: 1,
      });
    });

    it('returns null when the page cannot be read', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findPage({}, 0, 20)).resolves.toBeNull();
    });
  });
});

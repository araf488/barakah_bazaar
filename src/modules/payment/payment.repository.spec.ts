import { PinoLogger } from 'nestjs-pino';
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
import { createMockLogger } from '../../../test/support/mocks';
import { AuditLogRepository, AuditLogWriteData } from '../admin/audit-log.repository';
import {
  PAYMENT_DUPLICATE,
  PaymentRepository,
  RecordPaymentData,
  refundClearsOrder,
} from './payment.repository';

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

const bkashRow = (overrides: Partial<PaymentTransaction> = {}): PaymentTransaction => ({
  id: 'pay-1',
  orderId: 'ord-1',
  method: PaymentMethod.BKASH,
  direction: PaymentDirection.CHARGE,
  status: PaymentTransactionStatus.CAPTURED,
  amountPoysha: 250000n,
  gatewayReference: 'PAYID-1',
  gatewayTransactionId: 'TRX1',
  collectedBy: null,
  failureReason: null,
  capturedAt: new Date('2026-10-17T10:00:00Z'),
  createdAt: new Date('2026-10-17T09:58:00Z'),
  updatedAt: new Date('2026-10-17T10:00:00Z'),
  ...overrides,
});

const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });

const audit: AuditLogWriteData = {
  actorId: 'user-1',
  actorEmail: 'admin@barakahbazaar.com.bd',
  actorRole: 'SUPER_ADMIN',
  action: 'payment.refund_claim_resolved',
  entityType: 'PaymentTransaction',
  entityId: 'claim-1',
  before: { status: 'PENDING' },
  after: { outcome: 'refunded' },
  requestId: null,
};

/** The SQL text of a tagged-template call, placeholders as `?`, whitespace collapsed. */
const taggedSql = (call: unknown[]): string => (call[0] as string[]).join('?').replace(/\s+/g, ' ');

describe('PaymentRepository', () => {
  let tx: {
    paymentTransaction: {
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      count: jest.Mock;
      deleteMany: jest.Mock;
    };
    order: { update: jest.Mock; updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    orderEvent: { create: jest.Mock };
    stockReservation: { updateMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    paymentTransaction: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
      aggregate: jest.Mock;
    };
  };
  let auditLog: { appendWithin: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: PaymentRepository;

  beforeEach(() => {
    tx = {
      paymentTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(bkashRow()),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ord-1', status: 'CONFIRMED' }),
      },
      orderEvent: { create: jest.fn() },
      stockReservation: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'PLACED', payment_method: 'BKASH' }]),
    };
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
      $queryRaw: jest.fn(),
      paymentTransaction: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    auditLog = { appendWithin: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    repository = new PaymentRepository(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogRepository,
      logger,
    );
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

    it('counts only the method asked for, so a cash order never nets a bKash capture', async () => {
      prisma.paymentTransaction.groupBy.mockResolvedValue([]);

      await repository.totalsForOrder('ord-1', PaymentMethod.CASH_ON_DELIVERY);

      expect(prisma.paymentTransaction.groupBy.mock.calls[0][0].where).toEqual({
        orderId: 'ord-1',
        status: PaymentTransactionStatus.CAPTURED,
        method: PaymentMethod.CASH_ON_DELIVERY,
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

  describe('sumPendingRefundClaims', () => {
    it("sums the order's PENDING bKash refund claims", async () => {
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amountPoysha: 250000n } });

      await expect(repository.sumPendingRefundClaims('ord-1')).resolves.toBe(250000n);
      expect(prisma.paymentTransaction.aggregate).toHaveBeenCalledWith({
        where: {
          orderId: 'ord-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
        },
        _sum: { amountPoysha: true },
      });
    });

    it('answers zero when nothing is in flight', async () => {
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amountPoysha: null } });

      await expect(repository.sumPendingRefundClaims('ord-1')).resolves.toBe(0n);
    });

    it('returns null and logs when the read fails', async () => {
      prisma.paymentTransaction.aggregate.mockRejectedValue(new Error('connection reset'));

      await expect(repository.sumPendingRefundClaims('ord-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'Exception occurred in PaymentRepository.sumPendingRefundClaims',
      );
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

  describe('createAttempt', () => {
    const holdUntil = new Date('2026-10-17T10:15:00Z');
    const attempt = { orderId: 'ord-1', amountPoysha: 250000n, paymentId: 'PAYID-1' };

    it('opens a PENDING bKash charge keyed by the paymentID', async () => {
      await repository.createAttempt(attempt, holdUntil);

      expect(tx.paymentTransaction.create).toHaveBeenCalledWith({
        data: {
          orderId: 'ord-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.PENDING,
          amountPoysha: 250000n,
          gatewayReference: 'PAYID-1',
        },
      });
    });

    it("extends only the order's live holds that would lapse before the attempt window ends", async () => {
      await repository.createAttempt(attempt, holdUntil);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
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

    it('returns the attempt row it created', async () => {
      tx.paymentTransaction.create.mockResolvedValue(bkashRow({ status: 'PENDING' }));

      await expect(repository.createAttempt(attempt, holdUntil)).resolves.toEqual(
        bkashRow({ status: 'PENDING' }),
      );
    });

    it('answers duplicate when the paymentID is already recorded', async () => {
      tx.paymentTransaction.create.mockRejectedValue(uniqueViolation());

      await expect(repository.createAttempt(attempt, holdUntil)).resolves.toBe('duplicate');
      expect(tx.stockReservation.updateMany).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('returns null and logs on any other fault', async () => {
      tx.stockReservation.updateMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.createAttempt(attempt, holdUntil)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'Exception occurred in PaymentRepository.createAttempt',
      );
    });
  });

  describe('findAttemptByPaymentId', () => {
    it('looks the attempt up as a bKash charge by its paymentID', async () => {
      prisma.paymentTransaction.findFirst.mockResolvedValue(bkashRow());

      await expect(repository.findAttemptByPaymentId('PAYID-1')).resolves.toEqual(bkashRow());
      expect(prisma.paymentTransaction.findFirst).toHaveBeenCalledWith({
        where: {
          gatewayReference: 'PAYID-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
        },
      });
    });

    it('returns undefined for an unknown paymentID, distinct from a failed read', async () => {
      prisma.paymentTransaction.findFirst.mockResolvedValue(null);

      await expect(repository.findAttemptByPaymentId('PAYID-X')).resolves.toBeUndefined();
    });

    it('returns null when the lookup itself fails', async () => {
      prisma.paymentTransaction.findFirst.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findAttemptByPaymentId('PAYID-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('findAttemptWithOrderNumber', () => {
    it('returns the attempt with its order number, as a bKash charge by its paymentID', async () => {
      prisma.paymentTransaction.findFirst.mockResolvedValue({
        ...bkashRow(),
        order: { orderNumber: 'BB-20261017-000042' },
      });

      await expect(repository.findAttemptWithOrderNumber('PAYID-1')).resolves.toEqual({
        attempt: bkashRow(),
        orderNumber: 'BB-20261017-000042',
      });
      expect(prisma.paymentTransaction.findFirst).toHaveBeenCalledWith({
        where: {
          gatewayReference: 'PAYID-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
        },
        include: { order: { select: { orderNumber: true } } },
      });
    });

    it('returns undefined for an unknown paymentID, distinct from a failed read', async () => {
      prisma.paymentTransaction.findFirst.mockResolvedValue(null);

      await expect(repository.findAttemptWithOrderNumber('PAYID-X')).resolves.toBeUndefined();
    });

    it('returns null when the lookup itself fails', async () => {
      prisma.paymentTransaction.findFirst.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findAttemptWithOrderNumber('PAYID-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('closeAttempt', () => {
    it('moves a still-PENDING attempt to the given status with the reason', async () => {
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        repository.closeAttempt('pay-1', 'FAILED', 'bKash never completed this payment.'),
      ).resolves.toBe(true);
      expect(prisma.paymentTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-1', status: PaymentTransactionStatus.PENDING },
        data: {
          status: PaymentTransactionStatus.FAILED,
          failureReason: 'bKash never completed this payment.',
        },
      });
    });

    it('answers false when someone else already settled the attempt', async () => {
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.closeAttempt('pay-1', 'CANCELLED', 'cancel')).resolves.toBe(false);
    });

    it('truncates the reason so a gateway response body cannot land in the column', async () => {
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });

      await repository.closeAttempt('pay-1', 'FAILED', 'x'.repeat(900));

      expect(
        (
          prisma.paymentTransaction.updateMany.mock.calls[0][0] as {
            data: { failureReason: string };
          }
        ).data.failureReason,
      ).toHaveLength(500);
    });

    it('returns null when the write fails', async () => {
      prisma.paymentTransaction.updateMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.closeAttempt('pay-1', 'FAILED', 'x')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('captureAttempt', () => {
    const lockedOrder = (status: string, paymentMethod: string) => [
      { status, payment_method: paymentMethod },
    ];

    it('captures only a still-PENDING attempt, stamping the trxID and capture time', async () => {
      await repository.captureAttempt('pay-1', 'TRX1');

      expect(tx.paymentTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pay-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.PENDING,
        },
        data: {
          status: PaymentTransactionStatus.CAPTURED,
          gatewayTransactionId: 'TRX1',
          capturedAt: expect.any(Date) as Date,
        },
      });
    });

    it('answers already-settled and touches no order when the attempt was not PENDING', async () => {
      tx.paymentTransaction.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.captureAttempt('pay-1', 'TRX1')).resolves.toEqual({
        kind: 'already-settled',
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(tx.orderEvent.create).not.toHaveBeenCalled();
    });

    it('locks the order row before deciding', async () => {
      await repository.captureAttempt('pay-1', 'TRX1');

      const call = tx.$queryRaw.mock.calls[0] as unknown[];
      expect(taggedSql(call)).toContain('FROM orders WHERE id = ?::uuid FOR UPDATE');
      expect(call.slice(1)).toEqual(['ord-1']);
    });

    it('confirms an eligible order as paid, with its event, in the same transaction', async () => {
      const confirmed = { id: 'ord-1', status: OrderStatus.CONFIRMED };
      tx.order.findUniqueOrThrow.mockResolvedValue(confirmed);

      await expect(repository.captureAttempt('pay-1', 'TRX1')).resolves.toEqual({
        kind: 'confirmed',
        order: confirmed,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'ord-1', status: OrderStatus.PLACED },
        data: { status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID },
      });
      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: 'ord-1',
          fromStatus: OrderStatus.PLACED,
          toStatus: OrderStatus.CONFIRMED,
          actorId: null,
          note: 'Paid by bKash.',
        },
      });
      expect(tx.order.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'ord-1' },
        include: { items: true, events: { orderBy: { createdAt: 'asc' } } },
      });
    });

    it('counts only OTHER captured bKash charges on the order, leaving out mismatched captures', async () => {
      await repository.captureAttempt('pay-1', 'TRX1');

      expect(tx.paymentTransaction.count).toHaveBeenCalledWith({
        where: {
          orderId: 'ord-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.CAPTURED,
          id: { not: 'pay-1' },
          // A capture bKash completed for the wrong amount or order never paid for the order,
          // so it must not stop the customer's correct payment from confirming it.
          OR: [
            { failureReason: null },
            { failureReason: { not: 'bKash completed a different amount or order.' } },
          ],
        },
      });
    });

    it.each([
      [
        'the order is no longer PLACED',
        () => tx.$queryRaw.mockResolvedValue(lockedOrder('CANCELLED', 'BKASH')),
      ],
      [
        'the order switched to cash on delivery',
        () => tx.$queryRaw.mockResolvedValue(lockedOrder('PLACED', 'CASH_ON_DELIVERY')),
      ],
      ['another attempt already captured', () => tx.paymentTransaction.count.mockResolvedValue(1)],
    ])('answers refund-due with no order write when %s', async (_case, arrange) => {
      arrange();

      await expect(repository.captureAttempt('pay-1', 'TRX1')).resolves.toEqual({
        kind: 'refund-due',
        orderId: 'ord-1',
      });
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(tx.orderEvent.create).not.toHaveBeenCalled();
    });

    it('answers already-settled when the trxID is already recorded on another row', async () => {
      tx.paymentTransaction.updateMany.mockRejectedValue(uniqueViolation());

      await expect(repository.captureAttempt('pay-1', 'TRX1')).resolves.toEqual({
        kind: 'already-settled',
      });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { attemptId: 'pay-1' },
        'bKash transaction already recorded on another row',
      );
    });

    it('returns null and logs on any other fault', async () => {
      tx.$queryRaw.mockRejectedValue(new Error('connection reset'));

      await expect(repository.captureAttempt('pay-1', 'TRX1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ attemptId: 'pay-1' }),
        'Exception occurred in PaymentRepository.captureAttempt',
      );
    });
  });

  describe('captureMismatched', () => {
    it('captures a still-PENDING attempt with the amount bKash reported, marked as a mismatch', async () => {
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });

      await expect(repository.captureMismatched('pay-1', 'TRX1', 249999n)).resolves.toBe(true);

      expect(prisma.paymentTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pay-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.PENDING,
        },
        data: {
          status: PaymentTransactionStatus.CAPTURED,
          gatewayTransactionId: 'TRX1',
          capturedAt: expect.any(Date) as Date,
          amountPoysha: 249999n,
          failureReason: 'bKash completed a different amount or order.',
        },
      });
    });

    it('never touches the order: a mismatched payment confirms nothing', async () => {
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });

      await repository.captureMismatched('pay-1', 'TRX1', 249999n);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(tx.orderEvent.create).not.toHaveBeenCalled();
    });

    it('answers false when someone else already settled the attempt', async () => {
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.captureMismatched('pay-1', 'TRX1', 249999n)).resolves.toBe(false);
    });

    it('answers null and logs at error when the trxID is already recorded on another row', async () => {
      prisma.paymentTransaction.updateMany.mockRejectedValue(uniqueViolation());

      await expect(repository.captureMismatched('pay-1', 'TRX1', 249999n)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ attemptId: 'pay-1' }),
        'Exception occurred in PaymentRepository.captureMismatched',
      );
    });
  });

  describe('claimRefund', () => {
    it('inserts a PENDING system REFUND tied to the charge by its trxID, before bKash is called', async () => {
      prisma.paymentTransaction.create.mockResolvedValue(bkashRow({ id: 'claim-1' }));

      await expect(repository.claimRefund('ord-1', bkashRow(), 250000n)).resolves.toEqual(
        bkashRow({ id: 'claim-1' }),
      );
      expect(prisma.paymentTransaction.create).toHaveBeenCalledWith({
        data: {
          orderId: 'ord-1',
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
          amountPoysha: 250000n,
          gatewayReference: 'refund:TRX1',
          collectedBy: null,
        },
      });
    });

    it('claims the amount it was given, not the whole charge', async () => {
      await repository.claimRefund('ord-1', bkashRow(), 150000n);

      expect(
        (prisma.paymentTransaction.create.mock.calls[0][0] as { data: { amountPoysha: bigint } })
          .data.amountPoysha,
      ).toBe(150000n);
    });

    it('answers claimed when another pass already holds the refund for this charge', async () => {
      prisma.paymentTransaction.create.mockRejectedValue(uniqueViolation());

      await expect(repository.claimRefund('ord-1', bkashRow(), 250000n)).resolves.toBe('claimed');
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('refuses a charge with no trxID, which could never be tied to its refund', async () => {
      await expect(
        repository.claimRefund('ord-1', bkashRow({ gatewayTransactionId: null }), 250000n),
      ).resolves.toBeNull();
      expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { orderId: 'ord-1', chargeId: 'pay-1' },
        'Automatic refund does not fit its bKash charge',
      );
    });

    it.each([
      ['more than the charge', 250001n],
      ['zero', 0n],
      ['negative', -1n],
    ])('refuses an amount that is %s', async (_case, amount) => {
      await expect(repository.claimRefund('ord-1', bkashRow(), amount)).resolves.toBeNull();
      expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { orderId: 'ord-1', chargeId: 'pay-1' },
        'Automatic refund does not fit its bKash charge',
      );
    });

    it('returns null and logs on any other fault', async () => {
      prisma.paymentTransaction.create.mockRejectedValue(new Error('connection reset'));

      await expect(repository.claimRefund('ord-1', bkashRow(), 250000n)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1', chargeId: 'pay-1' }),
        'Exception occurred in PaymentRepository.claimRefund',
      );
    });
  });

  describe('completeRefund', () => {
    beforeEach(() => {
      tx.paymentTransaction.findUniqueOrThrow.mockResolvedValue(
        bkashRow({ id: 'claim-1', orderId: 'ord-9', direction: PaymentDirection.REFUND }),
      );
    });

    it("moves only a PENDING refund claim to CAPTURED with bKash's refund trxID", async () => {
      await expect(repository.completeRefund('claim-1', 'RFD1', false)).resolves.toBe(true);

      expect(tx.paymentTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'claim-1',
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
        },
        data: {
          status: PaymentTransactionStatus.CAPTURED,
          capturedAt: expect.any(Date) as Date,
          gatewayTransactionId: 'RFD1',
        },
      });
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('keeps a null refund trxID when bKash gave none', async () => {
      await repository.completeRefund('claim-1', null, false);

      expect(
        (
          tx.paymentTransaction.updateMany.mock.calls[0][0] as {
            data: { gatewayTransactionId: string | null };
          }
        ).data.gatewayTransactionId,
      ).toBeNull();
    });

    it("marks the claim's order REFUNDED in the same transaction when asked", async () => {
      await repository.completeRefund('claim-1', 'RFD1', true);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.paymentTransaction.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
      });
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-9' },
        data: { paymentStatus: PaymentStatus.REFUNDED },
      });
    });

    it('answers false, touching no order, when the claim is no longer PENDING', async () => {
      tx.paymentTransaction.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.completeRefund('claim-1', 'RFD1', true)).resolves.toBe(false);
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('appends the audit row in the same transaction when one is given', async () => {
      await expect(repository.completeRefund('claim-1', 'RFD1', false, audit)).resolves.toBe(true);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, audit);
    });

    it('writes no audit row when the claim was no longer PENDING', async () => {
      tx.paymentTransaction.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.completeRefund('claim-1', 'RFD1', false, audit)).resolves.toBe(false);
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('answers null, so the whole resolve rolls back, when the audit row cannot be written', async () => {
      auditLog.appendWithin.mockRejectedValue(new Error('connection reset'));

      await expect(repository.completeRefund('claim-1', 'RFD1', true, audit)).resolves.toBeNull();
    });

    it('answers duplicate when the refund trxID is already recorded on another row', async () => {
      tx.paymentTransaction.updateMany.mockRejectedValue(uniqueViolation());

      await expect(repository.completeRefund('claim-1', 'RFD1', false, audit)).resolves.toBe(
        PAYMENT_DUPLICATE,
      );
    });

    it('returns null and logs on a fault', async () => {
      tx.paymentTransaction.updateMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.completeRefund('claim-1', 'RFD1', true)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ claimId: 'claim-1' }),
        'Exception occurred in PaymentRepository.completeRefund',
      );
    });
  });

  describe('releaseRefundClaim', () => {
    it('deletes only a still-PENDING refund claim', async () => {
      await expect(repository.releaseRefundClaim('claim-1')).resolves.toBe(true);
      expect(tx.paymentTransaction.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'claim-1',
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
        },
      });
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('answers false when there was no PENDING claim to release', async () => {
      tx.paymentTransaction.deleteMany.mockResolvedValue({ count: 0 });

      await expect(repository.releaseRefundClaim('claim-1', audit)).resolves.toBe(false);
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('appends the audit row in the same transaction as the delete when one is given', async () => {
      await expect(repository.releaseRefundClaim('claim-1', audit)).resolves.toBe(true);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, audit);
    });

    it('answers null when the audit row cannot be written, so the claim is not deleted', async () => {
      auditLog.appendWithin.mockRejectedValue(new Error('connection reset'));

      await expect(repository.releaseRefundClaim('claim-1', audit)).resolves.toBeNull();
    });

    it('returns null and logs on a fault', async () => {
      tx.paymentTransaction.deleteMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.releaseRefundClaim('claim-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ claimId: 'claim-1' }),
        'Exception occurred in PaymentRepository.releaseRefundClaim',
      );
    });
  });

  describe('findById', () => {
    it('reads one ledger row by its id', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue(bkashRow());

      await expect(repository.findById('pay-1')).resolves.toEqual(bkashRow());
      expect(prisma.paymentTransaction.findUnique).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
    });

    it('answers undefined for an unknown id, distinct from a failed read', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue(null);

      await expect(repository.findById('pay-1')).resolves.toBeUndefined();
    });

    it('answers null and logs when the read fails', async () => {
      prisma.paymentTransaction.findUnique.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findById('pay-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'pay-1' }),
        'Exception occurred in PaymentRepository.findById',
      );
    });
  });

  describe('findOwedForOrder', () => {
    const owedSql = (): Prisma.Sql => prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;

    it('answers whether the order is cancelled and what it is still owed, by the §6 rule', async () => {
      prisma.$queryRaw.mockResolvedValue([{ cancelled: true, owed_poysha: '0' }]);

      await expect(repository.findOwedForOrder('ord-1')).resolves.toEqual({
        cancelled: true,
        owedPoysha: 0n,
      });
      const text = owedSql().sql.replace(/\s+/g, ' ');
      expect(text).toContain('WITH bkash AS');
      expect(text).toContain('FROM owing w WHERE w.order_id = ?::uuid');
      expect(owedSql().values).toContain('ord-1');
    });

    it('answers undefined for an order with no bKash rows', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(repository.findOwedForOrder('ord-1')).resolves.toBeUndefined();
    });

    it('answers null and logs when the query fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findOwedForOrder('ord-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'Exception occurred in PaymentRepository.findOwedForOrder',
      );
    });
  });

  describe('refundClearsOrder', () => {
    it.each([
      [true, 250000n, 250000n, true],
      [true, 250000n, 250001n, false],
      [false, 250000n, 250000n, false],
    ])(
      'with cancelled=%s, refunding %s of %s owed clears the order: %s',
      (cancelled, amount, owedBefore, clears) => {
        expect(refundClearsOrder(cancelled, amount, owedBefore)).toBe(clears);
      },
    );
  });

  describe('findPendingAttempts', () => {
    it('reads PENDING bKash charges older than the cut-off, oldest first', async () => {
      const olderThan = new Date('2026-10-17T09:58:00Z');
      prisma.paymentTransaction.findMany.mockResolvedValue([bkashRow({ status: 'PENDING' })]);

      await expect(repository.findPendingAttempts(olderThan, 50)).resolves.toEqual([
        bkashRow({ status: 'PENDING' }),
      ]);
      expect(prisma.paymentTransaction.findMany).toHaveBeenCalledWith({
        where: {
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.PENDING,
          createdAt: { lt: olderThan },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
    });

    it('returns null when the read fails', async () => {
      prisma.paymentTransaction.findMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findPendingAttempts(new Date(), 50)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('findStaleRefundClaims', () => {
    it('reads PENDING bKash REFUND claims opened before the cut-off, oldest first', async () => {
      const olderThan = new Date('2026-10-17T09:58:00Z');
      const claim = bkashRow({
        id: 'claim-1',
        direction: PaymentDirection.REFUND,
        status: PaymentTransactionStatus.PENDING,
      });
      prisma.paymentTransaction.findMany.mockResolvedValue([claim]);

      await expect(repository.findStaleRefundClaims(olderThan, 50)).resolves.toEqual([claim]);
      expect(prisma.paymentTransaction.findMany).toHaveBeenCalledWith({
        where: {
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.PENDING,
          createdAt: { lt: olderThan },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
    });

    it('returns null when the read fails', async () => {
      prisma.paymentTransaction.findMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findStaleRefundClaims(new Date(), 50)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Exception occurred in PaymentRepository.findStaleRefundClaims',
      );
    });
  });

  describe('findRefundsOwed', () => {
    const owedSql = (): Prisma.Sql => prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const owedText = (): string => owedSql().sql.replace(/\s+/g, ' ');

    it('pairs each owing order with its charge, in the order the query ranked them', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { order_id: 'ord-2', charge_id: 'pay-2', cancelled: false, owed_poysha: 250000n },
        { order_id: 'ord-1', charge_id: 'pay-1', cancelled: true, owed_poysha: 250000n },
      ]);
      prisma.paymentTransaction.findMany.mockResolvedValue([
        bkashRow(),
        bkashRow({ id: 'pay-2', orderId: 'ord-2', gatewayTransactionId: 'TRX2' }),
      ]);

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([
        {
          orderId: 'ord-2',
          charge: bkashRow({ id: 'pay-2', orderId: 'ord-2', gatewayTransactionId: 'TRX2' }),
          amountPoysha: 250000n,
          markRefunded: false,
        },
        { orderId: 'ord-1', charge: bkashRow(), amountPoysha: 250000n, markRefunded: true },
      ]);
      expect(prisma.paymentTransaction.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['pay-2', 'pay-1'] } },
      });
    });

    it.each([
      ['staff already refunded part of a cancelled order', 100000n, true, 100000n, true],
      ['two charges are owed on a cancelled order', 500000n, true, 250000n, false],
      ['the order switched to cash and the charge is owed', 250000n, false, 250000n, false],
      ['the driver returns the owed sum as text', '100000', true, 100000n, true],
    ])(
      'refunds the smaller of owed and the charge, marking REFUNDED only when it clears, when %s',
      async (_case, owed, cancelled, amount, markRefunded) => {
        prisma.$queryRaw.mockResolvedValue([
          { order_id: 'ord-1', charge_id: 'pay-1', cancelled, owed_poysha: owed },
        ]);
        prisma.paymentTransaction.findMany.mockResolvedValue([bkashRow()]);

        await expect(repository.findRefundsOwed(50)).resolves.toEqual([
          { orderId: 'ord-1', charge: bkashRow(), amountPoysha: amount, markRefunded },
        ]);
      },
    );

    it('answers an empty list without a second read when nothing is owed', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([]);
      expect(prisma.paymentTransaction.findMany).not.toHaveBeenCalled();
    });

    it('nets captured bKash charges against refunds and what a paid, confirmed order keeps', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findRefundsOwed(50);

      expect(owedText()).toContain('THEN o.total_poysha ELSE 0 END)::bigint AS owed_poysha');
      expect(owedText()).toContain('WHERE w.owed_poysha > 0');
      expect(owedText()).toContain('AND c.gateway_transaction_id IS NOT NULL');
      expect(owedSql().values).toEqual(
        expect.arrayContaining([
          'BKASH',
          'CAPTURED',
          'CHARGE',
          'REFUND',
          'PAID',
          'CONFIRMED',
          'PICKING',
          'DISPATCHED',
          'DELIVERED',
          'REFUNDED',
          'refund:',
          'CANCELLED',
        ]),
      );
      expect(owedSql().values).not.toContain('PLACED');
    });

    it('skips a charge with any refund row for its trxID, so a PENDING claim blocks reselection', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findRefundsOwed(50);

      expect(owedText()).toContain(
        'SELECT 1 FROM payment_transactions r WHERE r.direction::text = ? AND r.gateway_reference = ?::text || c.gateway_transaction_id )',
      );
    });

    it('nets in-flight refund claims as given back, so a claimed charge is never paid out twice', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findRefundsOwed(50);

      expect(owedText()).toContain(
        'WHERE p.method::text = ? AND (p.status::text = ? OR (p.direction::text = ? AND p.status::text = ?)) GROUP BY p.order_id',
      );
      expect(owedSql().values.slice(2, 6)).toEqual(['BKASH', 'CAPTURED', 'REFUND', 'PENDING']);
    });

    it('caps the batch at the size asked for', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findRefundsOwed(7);

      expect(owedText()).toMatch(/LIMIT \?$/);
      expect(owedSql().values.at(-1)).toBe(7);
    });

    it('returns null when the query fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findRefundsOwed(50)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        'Exception occurred in PaymentRepository.findRefundsOwed',
      );
    });
  });

  describe('findRefundOwedForOrder', () => {
    const owedSql = (): Prisma.Sql => prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const owedText = (): string => owedSql().sql.replace(/\s+/g, ' ');

    it("answers the one order's entry with the same min/markRefunded rule as the batch", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { order_id: 'ord-1', charge_id: 'pay-1', cancelled: true, owed_poysha: 250000n },
      ]);
      prisma.paymentTransaction.findMany.mockResolvedValue([bkashRow()]);

      await expect(repository.findRefundOwedForOrder('ord-1')).resolves.toEqual({
        orderId: 'ord-1',
        charge: bkashRow(),
        amountPoysha: 250000n,
        markRefunded: true,
      });
    });

    it('filters the owed query to the order before taking one row', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findRefundOwedForOrder('ord-7');

      expect(owedText()).toContain('WHERE w.owed_poysha > 0 AND w.order_id = ?::uuid ORDER BY');
      expect(owedText()).toMatch(/LIMIT \?$/);
      expect(owedSql().values.slice(-2)).toEqual(['ord-7', 1]);
    });

    it('leaves the batch query unfiltered', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await repository.findRefundsOwed(50);

      expect(owedText()).not.toContain('w.order_id = ?');
    });

    it('answers undefined when the order is owed nothing', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(repository.findRefundOwedForOrder('ord-1')).resolves.toBeUndefined();
      expect(prisma.paymentTransaction.findMany).not.toHaveBeenCalled();
    });

    it('answers null when the query fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findRefundOwedForOrder('ord-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        'Exception occurred in PaymentRepository.findRefundOwedForOrder',
      );
    });
  });
});

import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import {
  PaymentDirection,
  PaymentMethod,
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../../infra/prisma/prisma-client';
import { BkashCheckoutService } from './bkash-checkout.service';
import { BkashReconciliationSweeper } from './bkash-reconciliation.sweeper';
import { PaymentRepository, RefundOwed } from './payment.repository';
import { CheckoutOutcome, PaymentGateway } from './ports/payment-gateway.port';

const NOW = new Date('2026-10-17T10:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const attempt = (id: string, createdAt: Date, paymentId = `PAYID-${id}`): PaymentTransaction => ({
  id,
  orderId: `ord-${id}`,
  method: PaymentMethod.BKASH,
  direction: PaymentDirection.CHARGE,
  status: PaymentTransactionStatus.PENDING,
  amountPoysha: 250000n,
  gatewayReference: paymentId,
  gatewayTransactionId: null,
  collectedBy: null,
  failureReason: null,
  capturedAt: null,
  createdAt,
  updatedAt: createdAt,
});

const young = (id: string) => attempt(id, new Date(NOW.getTime() - 10 * MINUTE));

const owed = (id: string): RefundOwed => ({
  orderId: `ord-${id}`,
  charge: {
    ...attempt(id, new Date(NOW.getTime() - HOUR)),
    status: PaymentTransactionStatus.CAPTURED,
    gatewayTransactionId: `TRX-${id}`,
  },
  amountPoysha: 250000n,
  markRefunded: true,
});

const claim = (id: string): PaymentTransaction => ({
  ...attempt(id, new Date(NOW.getTime() - 30 * MINUTE)),
  direction: PaymentDirection.REFUND,
});

const completed: CheckoutOutcome = {
  kind: 'completed',
  transactionId: 'TRX-1',
  amountPoysha: 250000n,
  currency: 'BDT',
  orderNumber: 'BB-1',
};

describe('BkashReconciliationSweeper', () => {
  let payments: jest.Mocked<
    Pick<
      PaymentRepository,
      'findPendingAttempts' | 'closeAttempt' | 'findRefundsOwed' | 'findStaleRefundClaims'
    >
  >;
  let checkout: jest.Mocked<Pick<BkashCheckoutService, 'settle' | 'refundNow'>>;
  let gateway: jest.Mocked<Pick<PaymentGateway, 'queryCheckout'>>;
  let logger: jest.Mocked<PinoLogger>;
  let provider: string;
  let sweeper: BkashReconciliationSweeper;

  const build = (): BkashReconciliationSweeper =>
    new BkashReconciliationSweeper(
      payments as unknown as PaymentRepository,
      checkout as unknown as BkashCheckoutService,
      gateway as unknown as PaymentGateway,
      createMockConfig({ PAYMENT_PROVIDER: provider }),
      logger,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    provider = 'bkash';
    payments = {
      findPendingAttempts: jest.fn().mockResolvedValue([]),
      closeAttempt: jest.fn().mockResolvedValue(true),
      findRefundsOwed: jest.fn().mockResolvedValue([]),
      findStaleRefundClaims: jest.fn().mockResolvedValue([]),
    };
    checkout = { settle: jest.fn().mockResolvedValue('paid'), refundNow: jest.fn() };
    gateway = { queryCheckout: jest.fn().mockResolvedValue(completed) };
    logger = createMockLogger();
    sweeper = build();
  });

  afterEach(() => {
    sweeper.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('timer', () => {
    it('sweeps every five minutes and does not hold the process open', () => {
      const sweep = jest.spyOn(sweeper, 'sweep').mockResolvedValue();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      sweeper.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);
      const timer = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);

      jest.advanceTimersByTime(299_999);
      expect(sweep).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(sweep).toHaveBeenCalledTimes(1);
    });

    it('stops sweeping once destroyed', () => {
      const sweep = jest.spyOn(sweeper, 'sweep').mockResolvedValue();
      sweeper.onModuleInit();

      sweeper.onModuleDestroy();
      jest.advanceTimersByTime(10 * 300_000);

      expect(sweep).not.toHaveBeenCalled();
    });

    it('is safe to destroy before it was ever started', () => {
      expect(() => sweeper.onModuleDestroy()).not.toThrow();
    });
  });

  describe('noop provider', () => {
    it('returns at once and makes no query, no gateway call and no log', async () => {
      provider = 'noop';
      sweeper = build();

      await sweeper.sweep();

      expect(payments.findPendingAttempts).not.toHaveBeenCalled();
      expect(payments.findRefundsOwed).not.toHaveBeenCalled();
      expect(payments.findStaleRefundClaims).not.toHaveBeenCalled();
      expect(gateway.queryCheckout).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('pending attempts', () => {
    it('asks for attempts older than two minutes, fifty at a time', async () => {
      await sweeper.sweep();

      expect(payments.findPendingAttempts).toHaveBeenCalledWith(
        new Date('2026-10-17T09:58:00.000Z'),
        50,
      );
    });

    it('asks bKash about each attempt and settles what it said', async () => {
      payments.findPendingAttempts.mockResolvedValue([young('a'), young('b')]);

      await sweeper.sweep();

      expect(gateway.queryCheckout).toHaveBeenCalledWith('PAYID-a');
      expect(gateway.queryCheckout).toHaveBeenCalledWith('PAYID-b');
      expect(checkout.settle).toHaveBeenCalledWith(young('a'), completed);
      expect(checkout.settle).toHaveBeenCalledWith(young('b'), completed);
      expect(payments.closeAttempt).not.toHaveBeenCalled();
    });

    it('leaves a young attempt open when bKash says it is still pending', async () => {
      payments.findPendingAttempts.mockResolvedValue([young('a')]);
      gateway.queryCheckout.mockResolvedValue({ kind: 'pending' });
      checkout.settle.mockResolvedValue('pending');

      await sweeper.sweep();

      expect(payments.closeAttempt).not.toHaveBeenCalled();
    });

    it('does not abandon an attempt that is exactly 24 hours old', async () => {
      const boundary = attempt('a', new Date(NOW.getTime() - 24 * HOUR));
      payments.findPendingAttempts.mockResolvedValue([boundary]);
      gateway.queryCheckout.mockResolvedValue({ kind: 'pending' });
      checkout.settle.mockResolvedValue('pending');

      await sweeper.sweep();

      expect(payments.closeAttempt).not.toHaveBeenCalled();
    });

    it('asks bKash first, then abandons an attempt just over 24 hours old that is still pending', async () => {
      const old = attempt('a', new Date(NOW.getTime() - 24 * HOUR - 1));
      payments.findPendingAttempts.mockResolvedValue([old]);
      gateway.queryCheckout.mockResolvedValue({ kind: 'pending' });

      await sweeper.sweep();

      expect(gateway.queryCheckout).toHaveBeenCalledWith('PAYID-a');
      expect(payments.closeAttempt).toHaveBeenCalledWith(
        'a',
        'FAILED',
        'bKash never completed this payment.',
      );
      expect(checkout.settle).not.toHaveBeenCalled();
      expect(gateway.queryCheckout.mock.invocationCallOrder[0]).toBeLessThan(
        payments.closeAttempt.mock.invocationCallOrder[0],
      );
    });

    it('never closes an old attempt when bKash answers error; it settles the outcome and logs the id', async () => {
      const old = attempt('a', new Date(NOW.getTime() - 25 * HOUR));
      const unreadable: CheckoutOutcome = { kind: 'error', reason: 'timeout' };
      payments.findPendingAttempts.mockResolvedValue([old]);
      gateway.queryCheckout.mockResolvedValue(unreadable);
      checkout.settle.mockResolvedValue('pending');

      await sweeper.sweep();

      expect(payments.closeAttempt).not.toHaveBeenCalled();
      expect(checkout.settle).toHaveBeenCalledWith(old, unreadable);
      expect(logger.error).toHaveBeenCalledWith(
        { attemptId: 'a' },
        'bKash could not say how an old attempt ended; keeping it for the next pass',
      );
    });

    it('does not log an error for a young attempt bKash could not be reached for', async () => {
      payments.findPendingAttempts.mockResolvedValue([young('a')]);
      gateway.queryCheckout.mockResolvedValue({ kind: 'error', reason: 'timeout' });
      checkout.settle.mockResolvedValue('pending');

      await sweeper.sweep();

      expect(payments.closeAttempt).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('settles an old attempt on a later pass once bKash reads as completed after an error', async () => {
      const old = attempt('a', new Date(NOW.getTime() - 25 * HOUR));
      payments.findPendingAttempts.mockResolvedValue([old]);
      gateway.queryCheckout.mockResolvedValueOnce({ kind: 'error', reason: 'unreadable' });
      checkout.settle.mockResolvedValueOnce('pending');
      await sweeper.sweep();
      expect(payments.closeAttempt).not.toHaveBeenCalled();

      jest.setSystemTime(NOW.getTime() + 10 * MINUTE);
      gateway.queryCheckout.mockResolvedValueOnce(completed);
      checkout.settle.mockResolvedValueOnce('paid');
      await sweeper.sweep();

      expect(checkout.settle).toHaveBeenLastCalledWith(old, completed);
      expect(payments.closeAttempt).not.toHaveBeenCalled();
    });

    it('settles, and never closes, an old attempt bKash says completed, so the money is not lost', async () => {
      const old = attempt('a', new Date(NOW.getTime() - 48 * HOUR));
      payments.findPendingAttempts.mockResolvedValue([old]);
      gateway.queryCheckout.mockResolvedValue(completed);

      await sweeper.sweep();

      expect(checkout.settle).toHaveBeenCalledWith(old, completed);
      expect(payments.closeAttempt).not.toHaveBeenCalled();
    });

    it('settles an old attempt bKash says failed instead of abandoning it', async () => {
      const old = attempt('a', new Date(NOW.getTime() - 48 * HOUR));
      const failed: CheckoutOutcome = { kind: 'failed', reason: 'declined' };
      payments.findPendingAttempts.mockResolvedValue([old]);
      gateway.queryCheckout.mockResolvedValue(failed);

      await sweeper.sweep();

      expect(checkout.settle).toHaveBeenCalledWith(old, failed);
      expect(payments.closeAttempt).not.toHaveBeenCalled();
    });

    it('keeps going when one attempt throws', async () => {
      payments.findPendingAttempts.mockResolvedValue([young('a'), young('b')]);
      gateway.queryCheckout.mockRejectedValueOnce(new Error('boom'));

      await sweeper.sweep();

      expect(checkout.settle).toHaveBeenCalledTimes(1);
      expect(checkout.settle).toHaveBeenCalledWith(young('b'), completed);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ attemptId: 'a' }),
        'Exception occurred in BkashReconciliationSweeper while reconciling an attempt',
      );
    });

    it('keeps going when the abandon write fails for one attempt', async () => {
      const old = attempt('a', new Date(NOW.getTime() - 25 * HOUR));
      payments.findPendingAttempts.mockResolvedValue([old, young('b')]);
      gateway.queryCheckout.mockResolvedValueOnce({ kind: 'pending' });
      payments.closeAttempt.mockResolvedValue(null);

      await sweeper.sweep();

      expect(checkout.settle).toHaveBeenCalledWith(young('b'), completed);
      expect(logger.info).toHaveBeenCalledWith(
        { examined: 2, settled: 1, refunded: 0, failed: 1 },
        'bKash reconciliation finished',
      );
    });

    it('still reconciles refunds when the attempts cannot be read', async () => {
      payments.findPendingAttempts.mockResolvedValue(null);
      payments.findRefundsOwed.mockResolvedValue([owed('r1')]);
      checkout.refundNow.mockResolvedValue(true);

      await sweeper.sweep();

      expect(logger.warn).toHaveBeenCalledWith(
        'bKash reconciliation could not read pending attempts; will retry',
      );
      expect(checkout.refundNow).toHaveBeenCalledWith(owed('r1'));
    });
  });

  describe('refunds owed', () => {
    it('refunds each owed entry', async () => {
      payments.findRefundsOwed.mockResolvedValue([owed('r1'), owed('r2')]);
      checkout.refundNow.mockResolvedValue(true);

      await sweeper.sweep();

      expect(payments.findRefundsOwed).toHaveBeenCalledWith(50);
      expect(checkout.refundNow).toHaveBeenCalledTimes(2);
      expect(checkout.refundNow).toHaveBeenCalledWith(owed('r1'));
      expect(checkout.refundNow).toHaveBeenCalledWith(owed('r2'));
    });

    it('keeps going when one refund throws', async () => {
      payments.findRefundsOwed.mockResolvedValue([owed('r1'), owed('r2')]);
      checkout.refundNow.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);

      await sweeper.sweep();

      expect(checkout.refundNow).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        { examined: 2, settled: 0, refunded: 1, failed: 1 },
        'bKash reconciliation finished',
      );
    });

    it('warns and does nothing more when the owed list cannot be read', async () => {
      payments.findRefundsOwed.mockResolvedValue(null);

      await sweeper.sweep();

      expect(checkout.refundNow).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'bKash reconciliation could not read refunds owed; will retry',
      );
    });
  });

  describe('batch starvation', () => {
    it('sets a failed refund aside for 30 minutes and asks for enough extra rows to fill the batch', async () => {
      payments.findRefundsOwed.mockResolvedValue([owed('bad'), owed('good')]);
      checkout.refundNow.mockImplementation((entry) => Promise.resolve(entry.charge.id !== 'bad'));
      await sweeper.sweep();
      checkout.refundNow.mockClear();
      payments.findRefundsOwed.mockClear();

      jest.setSystemTime(NOW.getTime() + 5 * MINUTE);
      payments.findRefundsOwed.mockResolvedValue([owed('bad'), owed('next')]);
      await sweeper.sweep();

      expect(payments.findRefundsOwed).toHaveBeenCalledWith(51);
      expect(checkout.refundNow).toHaveBeenCalledTimes(1);
      expect(checkout.refundNow).toHaveBeenCalledWith(owed('next'));
    });

    it('also sets aside a refund that throws', async () => {
      payments.findRefundsOwed.mockResolvedValue([owed('bad'), owed('next')]);
      checkout.refundNow.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
      await sweeper.sweep();
      checkout.refundNow.mockClear();

      jest.setSystemTime(NOW.getTime() + 5 * MINUTE);
      await sweeper.sweep();

      expect(checkout.refundNow).toHaveBeenCalledTimes(1);
      expect(checkout.refundNow).toHaveBeenCalledWith(owed('next'));
    });

    it('retries the failed refund once the cooldown has passed', async () => {
      payments.findRefundsOwed.mockResolvedValue([owed('bad')]);
      checkout.refundNow.mockResolvedValue(false);
      await sweeper.sweep();
      checkout.refundNow.mockClear();
      payments.findRefundsOwed.mockClear();

      jest.setSystemTime(NOW.getTime() + 30 * MINUTE);
      await sweeper.sweep();

      expect(payments.findRefundsOwed).toHaveBeenCalledWith(50);
      expect(checkout.refundNow).toHaveBeenCalledWith(owed('bad'));
    });

    it('does not let set-aside refunds push the batch past fifty', async () => {
      const entries = Array.from({ length: 60 }, (_, index) => owed(`r${index}`));
      payments.findRefundsOwed.mockResolvedValue(entries);
      checkout.refundNow.mockResolvedValue(true);

      await sweeper.sweep();

      expect(checkout.refundNow).toHaveBeenCalledTimes(50);
    });
  });

  describe('batch starvation, attempts', () => {
    const stuck = Array.from({ length: 50 }, (_, index) => young(`s${index}`));
    const done = young('done');

    beforeEach(() => {
      gateway.queryCheckout.mockImplementation((paymentId) =>
        Promise.resolve(paymentId === 'PAYID-done' ? completed : { kind: 'pending' }),
      );
      checkout.settle.mockImplementation((_attempt, outcome) =>
        Promise.resolve(outcome.kind === 'completed' ? 'paid' : 'pending'),
      );
    });

    it('settles a completed attempt queued behind fifty stuck ones on the very next pass', async () => {
      payments.findPendingAttempts.mockResolvedValue(stuck);
      await sweeper.sweep();
      expect(checkout.settle).toHaveBeenCalledTimes(50);
      checkout.settle.mockClear();
      payments.findPendingAttempts.mockClear();

      jest.setSystemTime(NOW.getTime() + 5 * MINUTE);
      payments.findPendingAttempts.mockResolvedValue([...stuck, done]);
      await sweeper.sweep();

      expect(payments.findPendingAttempts).toHaveBeenCalledWith(expect.any(Date), 100);
      expect(checkout.settle).toHaveBeenCalledTimes(1);
      expect(checkout.settle).toHaveBeenCalledWith(done, completed);
    });

    it('asks bKash about a set-aside attempt again once the ten minute cooldown has passed', async () => {
      payments.findPendingAttempts.mockResolvedValue([young('s0')]);
      await sweeper.sweep();
      gateway.queryCheckout.mockClear();

      jest.setSystemTime(NOW.getTime() + 9 * MINUTE + 59_999);
      await sweeper.sweep();
      expect(gateway.queryCheckout).not.toHaveBeenCalled();

      jest.setSystemTime(NOW.getTime() + 10 * MINUTE);
      await sweeper.sweep();
      expect(gateway.queryCheckout).toHaveBeenCalledWith('PAYID-s0');
    });

    it('does not let set-aside attempts push the batch past fifty', async () => {
      const many = Array.from({ length: 60 }, (_, index) => young(`m${index}`));
      payments.findPendingAttempts.mockResolvedValue(many);
      gateway.queryCheckout.mockResolvedValue(completed);
      checkout.settle.mockResolvedValue('paid');

      await sweeper.sweep();

      expect(checkout.settle).toHaveBeenCalledTimes(50);
    });

    it('does not set aside an attempt that settled', async () => {
      payments.findPendingAttempts.mockResolvedValue([done]);
      await sweeper.sweep();
      checkout.settle.mockClear();

      await sweeper.sweep();

      expect(checkout.settle).toHaveBeenCalledTimes(1);
    });
  });

  describe('stale refund claims', () => {
    it('reads claims older than two minutes', async () => {
      await sweeper.sweep();

      expect(payments.findStaleRefundClaims).toHaveBeenCalledWith(
        new Date('2026-10-17T09:58:00.000Z'),
        50,
      );
    });

    it('reports them at error with the count and ids only, and never releases or retries them', async () => {
      payments.findStaleRefundClaims.mockResolvedValue([claim('c1'), claim('c2')]);

      await sweeper.sweep();

      expect(logger.error).toHaveBeenCalledWith(
        { count: 2, claimIds: ['c1', 'c2'] },
        'bKash refund claims are stuck pending and need a person to reconcile them',
      );
      expect(checkout.refundNow).not.toHaveBeenCalled();
      expect(payments.closeAttempt).not.toHaveBeenCalled();
    });

    it('stays quiet when there are none', async () => {
      await sweeper.sweep();

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('warns when the claims cannot be read', async () => {
      payments.findStaleRefundClaims.mockResolvedValue(null);

      await sweeper.sweep();

      expect(logger.warn).toHaveBeenCalledWith(
        'bKash reconciliation could not read stuck refund claims; will retry',
      );
    });
  });

  describe('summary and failure handling', () => {
    it('logs how many were examined, settled, refunded and failed', async () => {
      payments.findPendingAttempts.mockResolvedValue([young('a'), young('b'), young('c')]);
      checkout.settle
        .mockResolvedValueOnce('paid')
        .mockResolvedValueOnce('pending')
        .mockResolvedValueOnce(null);
      payments.findRefundsOwed.mockResolvedValue([owed('r1'), owed('r2')]);
      checkout.refundNow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await sweeper.sweep();

      expect(logger.info).toHaveBeenCalledWith(
        { examined: 5, settled: 1, refunded: 1, failed: 2 },
        'bKash reconciliation finished',
      );
    });

    it('logs nothing at info when there was nothing to examine', async () => {
      await sweeper.sweep();

      expect(logger.info).not.toHaveBeenCalled();
    });

    it('never rethrows, even when a repository read throws', async () => {
      payments.findPendingAttempts.mockRejectedValue(new Error('boom'));

      await expect(sweeper.sweep()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Exception occurred in BkashReconciliationSweeper.sweep',
      );
    });
  });
});

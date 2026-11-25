import { PinoLogger } from 'nestjs-pino';
import {
  Language,
  NotificationChannel,
  NotificationStatus,
} from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { OrderRepository } from '../order/order.repository';
import { NotificationRetryService } from './notification-retry.service';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

const pendingRow = (overrides = {}) => ({
  id: 'ntf-1',
  userId: 'user-1',
  channel: NotificationChannel.SMS,
  templateId: 'order.placed',
  language: Language.BN,
  recipient: '+8801711111111',
  status: NotificationStatus.FAILED,
  attempts: 1,
  lastError: 'gateway timeout',
  referenceType: 'Order',
  referenceId: 'ord-1',
  sentAt: null,
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
  updatedAt: new Date('2026-08-30T00:00:00.000Z'),
  ...overrides,
});

describe('NotificationRetryService', () => {
  let repository: { findRetryable: jest.Mock };
  let notifications: { retry: jest.Mock };
  let orders: { findById: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let sweeper: NotificationRetryService;

  beforeEach(() => {
    repository = { findRetryable: jest.fn() };
    notifications = { retry: jest.fn().mockResolvedValue(true) };
    orders = {
      findById: jest.fn().mockResolvedValue({
        orderNumber: 'BB-20260830-000042',
        recipientName: 'Rahim Uddin',
        totalPoysha: 250000n,
      }),
    };
    logger = createMockLogger();
    sweeper = new NotificationRetryService(
      repository as unknown as NotificationRepository,
      notifications as unknown as NotificationService,
      orders as unknown as OrderRepository,
      logger,
    );
  });

  it('retries every pending message', async () => {
    repository.findRetryable.mockResolvedValue([pendingRow(), pendingRow({ id: 'ntf-2' })]);

    await sweeper.sweep();

    expect(notifications.retry).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the variables from the order as it is now, not from a stored copy', async () => {
    repository.findRetryable.mockResolvedValue([pendingRow()]);
    orders.findById.mockResolvedValue({
      orderNumber: 'BB-20260830-000042',
      recipientName: 'Karim Mia',
      totalPoysha: 999900n,
    });

    await sweeper.sweep();

    expect(notifications.retry).toHaveBeenCalledWith(expect.objectContaining({ id: 'ntf-1' }), {
      orderNumber: 'BB-20260830-000042',
      recipientName: 'Karim Mia',
      total: '৳9,999.00',
    });
  });

  it('does nothing when nothing is pending', async () => {
    repository.findRetryable.mockResolvedValue([]);

    await sweeper.sweep();

    expect(notifications.retry).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('holds off rather than guessing when the pending list cannot be read', async () => {
    repository.findRetryable.mockResolvedValue(null);

    await sweeper.sweep();

    expect(notifications.retry).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips a message whose order has gone, without burning its attempts', async () => {
    repository.findRetryable.mockResolvedValue([pendingRow()]);
    orders.findById.mockResolvedValue(undefined);

    await sweeper.sweep();

    expect(notifications.retry).not.toHaveBeenCalled();
  });

  it('skips a message that is not about an order', async () => {
    repository.findRetryable.mockResolvedValue([
      pendingRow({ referenceType: null, referenceId: null }),
    ]);

    await sweeper.sweep();

    expect(orders.findById).not.toHaveBeenCalled();
    expect(notifications.retry).not.toHaveBeenCalled();
  });

  it('keeps going after one message fails', async () => {
    repository.findRetryable.mockResolvedValue([pendingRow(), pendingRow({ id: 'ntf-2' })]);
    notifications.retry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await sweeper.sweep();

    expect(logger.info).toHaveBeenCalledWith(
      { examined: 2, sent: 1 },
      'Retried pending notifications',
    );
  });

  it('swallows a thrown error so a failed tick cannot take the process down', async () => {
    repository.findRetryable.mockRejectedValue(new Error('connection reset'));

    await expect(sweeper.sweep()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  describe('lifecycle', () => {
    afterEach(() => {
      sweeper.onModuleDestroy();
      jest.useRealTimers();
    });

    it('sweeps on a timer once started', async () => {
      jest.useFakeTimers();
      repository.findRetryable.mockResolvedValue([]);

      sweeper.onModuleInit();
      jest.advanceTimersByTime(5 * 60_000);
      await Promise.resolve();

      expect(repository.findRetryable).toHaveBeenCalledTimes(1);
    });

    it('stops once shut down', async () => {
      jest.useFakeTimers();
      repository.findRetryable.mockResolvedValue([]);

      sweeper.onModuleInit();
      sweeper.onModuleDestroy();
      jest.advanceTimersByTime(60 * 60_000);
      await Promise.resolve();

      expect(repository.findRetryable).not.toHaveBeenCalled();
    });

    it('shuts down cleanly when it was never started', () => {
      expect(() => sweeper.onModuleDestroy()).not.toThrow();
    });
  });
});

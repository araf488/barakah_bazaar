import { PinoLogger } from 'nestjs-pino';
import {
  Language,
  NotificationChannel,
  NotificationStatus,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { NotificationRepository } from './notification.repository';

describe('NotificationRepository', () => {
  let prisma: {
    notification: {
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: NotificationRepository;

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((promises: unknown[]) => Promise.all(promises)),
    };
    logger = createMockLogger();
    repository = new NotificationRepository(prisma as unknown as PrismaService, logger);
  });

  const recordData = {
    userId: 'user-1',
    channel: NotificationChannel.SMS,
    templateId: 'order.placed',
    language: Language.BN,
    recipient: '+8801711111111',
    referenceType: 'Order',
    referenceId: 'ord-1',
  };

  describe('record', () => {
    it('returns the created row', async () => {
      prisma.notification.create.mockResolvedValue({ id: 'ntf-1' });

      await expect(repository.record(recordData)).resolves.toEqual({ id: 'ntf-1' });
    });

    it('returns null instead of throwing, so a failed record cannot fail a checkout', async () => {
      prisma.notification.create.mockRejectedValue(new Error('connection refused'));

      await expect(repository.record(recordData)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('markSent', () => {
    it('stamps the send time, clears the last error and counts the attempt', async () => {
      prisma.notification.update.mockResolvedValue({});

      await expect(repository.markSent('ntf-1')).resolves.toBe(true);

      const { data } = prisma.notification.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };

      expect(data.status).toBe(NotificationStatus.SENT);
      expect(data.lastError).toBeNull();
      expect(data.attempts).toEqual({ increment: 1 });
      expect(data.sentAt).toBeInstanceOf(Date);
    });

    it('returns false rather than throwing when the update fails', async () => {
      prisma.notification.update.mockRejectedValue(new Error('deadlock'));

      await expect(repository.markSent('ntf-1')).resolves.toBe(false);
    });
  });

  describe('markFailed', () => {
    it('leaves a message retryable while it still has attempts left', async () => {
      prisma.notification.update.mockResolvedValue({});

      await repository.markFailed('ntf-1', 0, 'gateway timeout');

      expect(
        (prisma.notification.update.mock.calls[0][0] as { data: { status: string } }).data.status,
      ).toBe(NotificationStatus.FAILED);
    });

    it('abandons a message once this attempt burns the last one', async () => {
      prisma.notification.update.mockResolvedValue({});

      await repository.markFailed('ntf-1', 2, 'invalid number');

      expect(
        (prisma.notification.update.mock.calls[0][0] as { data: { status: string } }).data.status,
      ).toBe(NotificationStatus.ABANDONED);
    });

    it('truncates the gateway error so a response body cannot land in the column', async () => {
      prisma.notification.update.mockResolvedValue({});

      await repository.markFailed('ntf-1', 0, 'x'.repeat(900));

      const { lastError } = (
        prisma.notification.update.mock.calls[0][0] as { data: { lastError: string } }
      ).data;

      expect(lastError).toHaveLength(500);
    });
  });

  describe('findRetryable', () => {
    it('asks only for messages not yet delivered and not yet out of attempts', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await repository.findRetryable();

      const { where, orderBy, take } = prisma.notification.findMany.mock.calls[0][0] as {
        where: { status: { in: string[] }; attempts: { lt: number } };
        orderBy: unknown;
        take: number;
      };

      expect(where.status.in).toEqual([NotificationStatus.PENDING, NotificationStatus.FAILED]);
      expect(where.attempts.lt).toBe(3);
      expect(orderBy).toEqual({ createdAt: 'asc' });
      expect(take).toBe(50);
    });

    it('returns null rather than an empty batch when the read fails', async () => {
      prisma.notification.findMany.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findRetryable()).resolves.toBeNull();
    });
  });

  describe('findPageForUser', () => {
    it('scopes the page to the owner and counts with the same filter', async () => {
      prisma.notification.findMany.mockResolvedValue([{ id: 'ntf-1' }]);
      prisma.notification.count.mockResolvedValue(1);

      await expect(repository.findPageForUser('user-1', 0, 20)).resolves.toEqual({
        items: [{ id: 'ntf-1' }],
        total: 1,
      });

      expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
      expect(prisma.notification.count.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    });

    it('returns null when the page cannot be read', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findPageForUser('user-1', 0, 20)).resolves.toBeNull();
    });
  });

  describe('findLanguage', () => {
    it("returns the customer's stored preference", async () => {
      prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.EN });

      await expect(repository.findLanguage('user-1')).resolves.toBe(Language.EN);
    });

    it('returns null for an unknown user rather than guessing a language', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(repository.findLanguage('user-1')).resolves.toBeNull();
    });

    it('returns null when the lookup fails', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findLanguage('user-1')).resolves.toBeNull();
    });
  });
});

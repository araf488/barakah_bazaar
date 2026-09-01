import { PinoLogger } from 'nestjs-pino';
import { ReviewStatus } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { ReviewRepository } from './review.repository';

describe('ReviewRepository', () => {
  let tx: {
    review: { updateMany: jest.Mock; aggregate: jest.Mock; findUniqueOrThrow: jest.Mock };
    product: { update: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    review: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    orderItem: { findUnique: jest.Mock };
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: ReviewRepository;

  beforeEach(() => {
    tx = {
      review: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { rating: 14 }, _count: { _all: 3 } }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'rev-1' }),
      },
      product: { update: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
      review: {
        create: jest.fn().mockResolvedValue({ id: 'rev-1' }),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      orderItem: { findUnique: jest.fn() },
    };
    logger = createMockLogger();
    repository = new ReviewRepository(prisma as unknown as PrismaService, logger);
  });

  describe('moderateAndRecount', () => {
    it('recomputes the rating from published rows rather than incrementing', async () => {
      // An increment is how a denormalised aggregate drifts: a publish that runs twice, or
      // one that races a rejection, leaves a number nothing can reproduce.
      await repository.moderateAndRecount(
        'rev-1',
        'prod-1',
        ReviewStatus.PUBLISHED,
        'user-1',
        null,
      );

      expect(tx.review.aggregate.mock.calls[0][0].where).toEqual({
        productId: 'prod-1',
        status: ReviewStatus.PUBLISHED,
      });
      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { ratingSum: 14, ratingCount: 3 },
      });
    });

    it('writes the moderation and the recount in one transaction', async () => {
      await repository.moderateAndRecount('rev-1', 'prod-1', ReviewStatus.PUBLISHED, 'u', null);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('zeroes the rating when the last published review is withdrawn', async () => {
      tx.review.aggregate.mockResolvedValue({ _sum: { rating: null }, _count: { _all: 0 } });

      await repository.moderateAndRecount('rev-1', 'prod-1', ReviewStatus.REJECTED, 'u', null);

      expect(tx.product.update.mock.calls[0][0].data).toEqual({ ratingSum: 0, ratingCount: 0 });
    });

    it('only settles a review that is still pending', async () => {
      await repository.moderateAndRecount('rev-1', 'prod-1', ReviewStatus.PUBLISHED, 'u', null);

      expect(tx.review.updateMany.mock.calls[0][0].where).toEqual({
        id: 'rev-1',
        status: ReviewStatus.PENDING,
      });
    });

    it('returns null and touches no rating when another moderator won the race', async () => {
      tx.review.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.moderateAndRecount('rev-1', 'prod-1', ReviewStatus.PUBLISHED, 'u', null),
      ).resolves.toBeNull();

      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('logs a lost race at info, not as an error', async () => {
      tx.review.updateMany.mockResolvedValue({ count: 0 });

      await repository.moderateAndRecount('rev-1', 'prod-1', ReviewStatus.PUBLISHED, 'u', null);

      expect(logger.info).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('rolls the whole thing back when the recount fails', async () => {
      tx.product.update.mockRejectedValue(new Error('deadlock'));

      await expect(
        repository.moderateAndRecount('rev-1', 'prod-1', ReviewStatus.PUBLISHED, 'u', null),
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('findReviewableLine', () => {
    it('fetches ownership, delivery status and any prior review in one read', async () => {
      prisma.orderItem.findUnique.mockResolvedValue(null);

      await repository.findReviewableLine('line-1');

      const { select } = prisma.orderItem.findUnique.mock.calls[0][0] as {
        select: Record<string, unknown>;
      };

      expect(select.order).toEqual({ select: { userId: true, status: true } });
      expect(select.variant).toEqual({ select: { productId: true } });
      expect(select.review).toEqual({ select: { id: true } });
    });

    it('returns undefined for a line that does not exist', async () => {
      prisma.orderItem.findUnique.mockResolvedValue(null);

      await expect(repository.findReviewableLine('line-1')).resolves.toBeUndefined();
    });

    it('returns null when the read fails', async () => {
      prisma.orderItem.findUnique.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findReviewableLine('line-1')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('returns null when the unique index rejects a second review on a line', async () => {
      prisma.review.create.mockRejectedValue(new Error('unique constraint'));

      await expect(
        repository.create({
          productId: 'prod-1',
          orderItemId: 'line-1',
          userId: 'user-1',
          rating: 5,
          title: null,
          body: null,
        }),
      ).resolves.toBeNull();
    });
  });

  describe('paging', () => {
    it('filters the storefront list to published rows only', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      await repository.findPublishedForProduct('prod-1', 0, 20);

      expect(prisma.review.findMany.mock.calls[0][0].where).toEqual({
        productId: 'prod-1',
        status: ReviewStatus.PUBLISHED,
      });
    });

    it('returns every status when the queue asks for none', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      await repository.findForModeration(undefined, 0, 20);

      expect(prisma.review.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('returns null when the page cannot be read', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findPublishedForProduct('prod-1', 0, 20)).resolves.toBeNull();
    });
  });
});

import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { OrderStatus, ReviewStatus, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { ReviewRepository } from './review.repository';
import { ReviewService } from './review.service';

const customer: AuthenticatedUser = {
  userId: 'sub-1',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.CUSTOMER,
};
const staff: AuthenticatedUser = {
  userId: 'sub-2',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.MARKETING,
};

const line = (overrides = {}) => ({
  id: 'line-1',
  variantId: 'var-1',
  order: { userId: 'user-1', status: OrderStatus.DELIVERED },
  variant: { productId: 'prod-1' },
  review: null,
  ...overrides,
});

const review = (overrides = {}) => ({
  id: 'rev-1',
  productId: 'prod-1',
  orderItemId: 'line-1',
  userId: 'user-1',
  rating: 5,
  title: 'Excellent',
  body: 'Fresh and well packed.',
  status: ReviewStatus.PENDING,
  moderatedBy: null,
  moderatedAt: null,
  moderationNote: null,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  ...overrides,
});

describe('ReviewService', () => {
  let repository: {
    findReviewableLine: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    moderateAndRecount: jest.Mock;
    findPublishedForProduct: jest.Mock;
    findForModeration: jest.Mock;
  };
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: ReviewService;

  beforeEach(() => {
    repository = {
      findReviewableLine: jest.fn().mockResolvedValue(line()),
      create: jest.fn().mockResolvedValue(review()),
      findById: jest.fn().mockResolvedValue(review()),
      moderateAndRecount: jest.fn().mockResolvedValue(review({ status: ReviewStatus.PUBLISHED })),
      findPublishedForProduct: jest.fn(),
      findForModeration: jest.fn(),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new ReviewService(
      repository as unknown as ReviewRepository,
      authService as unknown as AuthService,
      logger,
    );
  });

  const dto = (overrides = {}) => ({ orderItemId: 'line-1', rating: 5, ...overrides });

  describe('verified purchase', () => {
    it('takes the product from the order line, never from the request', async () => {
      // There is no productId in the payload at all, so a review cannot be aimed at
      // something the customer did not buy.
      await service.create(customer, dto());

      expect(repository.create.mock.calls[0][0]).toMatchObject({
        productId: 'prod-1',
        orderItemId: 'line-1',
        userId: 'user-1',
      });
    });

    it("answers someone else's line exactly as it answers a line that does not exist", async () => {
      repository.findReviewableLine.mockResolvedValue(
        line({ order: { userId: 'other', status: OrderStatus.DELIVERED } }),
      );
      const foreign = await service.create(customer, dto());

      repository.findReviewableLine.mockResolvedValue(undefined);
      const missing = await service.create(customer, dto());

      expect(foreign).toEqual(missing);
      expect(foreign).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'You can only review something you have received.',
      });
    });

    it('refuses a line that has not been delivered', async () => {
      repository.findReviewableLine.mockResolvedValue(
        line({ order: { userId: 'user-1', status: OrderStatus.DISPATCHED } }),
      );

      const result = await service.create(customer, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'You can review this once it has been delivered.',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a second review on the same line', async () => {
      repository.findReviewableLine.mockResolvedValue(line({ review: { id: 'rev-existing' } }));

      const result = await service.create(customer, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'You have already reviewed this item.',
      });
    });

    it('reports 503 rather than not-found when the line cannot be read', async () => {
      repository.findReviewableLine.mockResolvedValue(null);

      const result = await service.create(customer, dto());

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('a new review is not public', () => {
    it('is created PENDING, whatever the customer sent', async () => {
      await service.create(customer, dto());

      expect(repository.create.mock.calls[0][0]).not.toHaveProperty('status');
    });

    it('never exposes the order line or author in the public shape', async () => {
      const result = await service.create(customer, dto());

      expect(result.ok && result.data).not.toHaveProperty('orderItemId');
      expect(result.ok && result.data).not.toHaveProperty('userId');
      expect(result.ok && result.data).not.toHaveProperty('status');
    });

    it('marks it a verified purchase, which the schema guarantees', async () => {
      const result = await service.create(customer, dto());

      expect(result.ok && result.data.isVerifiedPurchase).toBe(true);
    });
  });

  describe('moderation', () => {
    it('publishes and rebuilds the product rating in one call', async () => {
      await service.publish(staff, 'rev-1', {});

      expect(repository.moderateAndRecount).toHaveBeenCalledWith(
        'rev-1',
        'prod-1',
        ReviewStatus.PUBLISHED,
        'user-1',
        null,
      );
    });

    it('rejects with the internal note', async () => {
      repository.moderateAndRecount.mockResolvedValue(review({ status: ReviewStatus.REJECTED }));

      await service.reject(staff, 'rev-1', { note: 'unverifiable halal claim' });

      expect(repository.moderateAndRecount).toHaveBeenCalledWith(
        'rev-1',
        'prod-1',
        ReviewStatus.REJECTED,
        'user-1',
        'unverifiable halal claim',
      );
    });

    it('refuses to moderate one that is already settled', async () => {
      repository.findById.mockResolvedValue(review({ status: ReviewStatus.PUBLISHED }));

      const result = await service.publish(staff, 'rev-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This review has already been moderated.',
      });
      expect(repository.moderateAndRecount).not.toHaveBeenCalled();
    });

    it('reports the race as a conflict when someone else moderated first', async () => {
      repository.moderateAndRecount.mockResolvedValue(null);

      const result = await service.publish(staff, 'rev-1', {});

      expect(result.ok === false && result.status).toBe(HttpStatus.CONFLICT);
    });

    it('reports 404 for a review that does not exist', async () => {
      repository.findById.mockResolvedValue(undefined);

      const result = await service.publish(staff, 'rev-1', {});

      expect(result.ok === false && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('shows staff the moderation trail the customer never sees', async () => {
      repository.moderateAndRecount.mockResolvedValue(
        review({
          status: ReviewStatus.REJECTED,
          moderationNote: 'internal',
          moderatedBy: 'user-1',
        }),
      );

      const result = await service.reject(staff, 'rev-1', { note: 'internal' });

      expect(result.ok && result.data).toMatchObject({
        status: ReviewStatus.REJECTED,
        moderationNote: 'internal',
        moderatedBy: 'user-1',
      });
    });
  });

  describe('listing', () => {
    it('asks only for published reviews on the storefront', async () => {
      repository.findPublishedForProduct.mockResolvedValue({ items: [], total: 0 });

      await service.listForProduct('prod-1', {});

      expect(repository.findPublishedForProduct).toHaveBeenCalledWith('prod-1', 0, 20);
    });

    it('never leaks the moderation note to the storefront', async () => {
      repository.findPublishedForProduct.mockResolvedValue({
        items: [review({ status: ReviewStatus.PUBLISHED, moderationNote: 'internal only' })],
        total: 1,
      });

      const result = await service.listForProduct('prod-1', {});

      expect(result.ok && JSON.stringify(result.data)).not.toContain('internal only');
    });

    it('pages from one rather than zero', async () => {
      repository.findPublishedForProduct.mockResolvedValue({ items: [], total: 0 });

      await service.listForProduct('prod-1', { page: 3, pageSize: 10 });

      expect(repository.findPublishedForProduct).toHaveBeenCalledWith('prod-1', 20, 10);
    });

    it('defaults the moderation queue to every status when none is given', async () => {
      repository.findForModeration.mockResolvedValue({ items: [], total: 0 });

      await service.listForModeration({});

      expect(repository.findForModeration).toHaveBeenCalledWith(undefined, 0, 20);
    });

    it('reports 503 when the queue cannot be read', async () => {
      repository.findForModeration.mockResolvedValue(null);

      const result = await service.listForModeration({});

      expect(result.ok).toBe(false);
    });
  });
});

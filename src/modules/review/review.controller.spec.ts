import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ReviewStatus, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminReviewController, ReviewController } from './review.controller';
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

describe('ReviewController', () => {
  let reviews: {
    create: jest.Mock;
    listForProduct: jest.Mock;
    listForModeration: jest.Mock;
    publish: jest.Mock;
    reject: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let controller: ReviewController;
  let admin: AdminReviewController;

  beforeEach(() => {
    reviews = {
      create: jest.fn(),
      listForProduct: jest.fn(),
      listForModeration: jest.fn(),
      publish: jest.fn(),
      reject: jest.fn(),
    };
    logger = createMockLogger();
    controller = new ReviewController(reviews as unknown as ReviewService, logger);
    admin = new AdminReviewController(reviews as unknown as ReviewService, logger);
  });

  describe('authorization', () => {
    it('leaves reading and writing reviews open to any signed-in customer', () => {
      expect(new Reflector().get(MetadataKeys.Roles, ReviewController)).toBeUndefined();
    });

    it('restricts moderation to super admins and marketing', () => {
      expect(new Reflector().get(MetadataKeys.Roles, AdminReviewController)).toEqual([
        UserRole.SUPER_ADMIN,
        UserRole.MARKETING,
      ]);
    });
  });

  it('passes the caller through when creating', async () => {
    reviews.create.mockResolvedValue({ ok: true, data: { id: 'rev-1' } });

    await controller.create(customer, { orderItemId: 'line-1', rating: 5 });

    expect(reviews.create).toHaveBeenCalledWith(customer, {
      orderItemId: 'line-1',
      rating: 5,
    });
  });

  it('turns an undelivered line into a 409', async () => {
    reviews.create.mockResolvedValue({
      ok: false,
      status: HttpStatus.CONFLICT,
      message: 'You can review this once it has been delivered.',
    });

    await expect(controller.create(customer, { orderItemId: 'line-1', rating: 5 })).rejects.toThrow(
      HttpException,
    );
  });

  it('returns the published list for a product', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 20 };
    reviews.listForProduct.mockResolvedValue({ ok: true, data: page });

    await expect(controller.listForProduct('prod-1', {})).resolves.toEqual(page);
  });

  it('publishes by id, with the actor', async () => {
    reviews.publish.mockResolvedValue({
      ok: true,
      data: { id: 'rev-1', status: ReviewStatus.PUBLISHED },
    });

    await admin.publish(staff, 'rev-1', {});

    expect(reviews.publish).toHaveBeenCalledWith(staff, 'rev-1', {});
  });

  it('rejects with the internal note', async () => {
    reviews.reject.mockResolvedValue({
      ok: true,
      data: { id: 'rev-1', status: ReviewStatus.REJECTED },
    });

    await admin.reject(staff, 'rev-1', { note: 'unverifiable claim' });

    expect(reviews.reject).toHaveBeenCalledWith(staff, 'rev-1', { note: 'unverifiable claim' });
  });

  it('logs with the review id when moderation throws', async () => {
    reviews.publish.mockRejectedValue(new Error('boom'));

    await expect(admin.publish(staff, 'rev-1', {})).rejects.toThrow('boom');
    expect(logger.error.mock.calls[0][0]).toMatchObject({ reviewId: 'rev-1' });
  });
});

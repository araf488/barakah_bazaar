import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PromotionType, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { AdminPromotionService } from './admin-promotion.service';
import { AdminPromotionController, PromotionController } from './promotion.controller';
import { PromotionService } from './promotion.service';

const customer: AuthenticatedUser = { supabaseUserId: 'sub-1', role: UserRole.CUSTOMER };
const marketer: AuthenticatedUser = { supabaseUserId: 'sub-2', role: UserRole.MARKETING };

describe('PromotionController', () => {
  let promotions: { apply: jest.Mock };
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let controller: PromotionController;

  beforeEach(() => {
    promotions = { apply: jest.fn() };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    controller = new PromotionController(
      promotions as unknown as PromotionService,
      authService as unknown as AuthService,
      logger,
    );
  });

  it('previews against the caller, since the per-customer limit is part of the answer', async () => {
    promotions.apply.mockResolvedValue({
      ok: true,
      data: {
        promotion: { code: 'EID25', nameEn: 'Eid 25%', nameBn: null },
        discountPoysha: 25000n,
      },
    });

    await controller.preview(customer, { code: 'EID25', subtotalPoysha: 100000 });

    expect(promotions.apply).toHaveBeenCalledWith('EID25', {
      subtotalPoysha: 100000n,
      deliveryFeePoysha: 0n,
      userId: 'user-1',
    });
  });

  it('returns only what this basket saves, not the promotion terms', async () => {
    promotions.apply.mockResolvedValue({
      ok: true,
      data: {
        promotion: {
          code: 'EID25',
          nameEn: 'Eid 25%',
          nameBn: null,
          usageLimit: 100,
          minSubtotalPoysha: 5000n,
        },
        discountPoysha: 25000n,
      },
    });

    const result = await controller.preview(customer, {
      code: 'EID25',
      subtotalPoysha: 100000,
    });

    expect(result).toEqual({
      code: 'EID25',
      nameEn: 'Eid 25%',
      nameBn: null,
      discountPoysha: 25000,
    });
  });

  it('passes the delivery fee through for free-delivery codes', async () => {
    promotions.apply.mockResolvedValue({
      ok: true,
      data: { promotion: { code: 'F', nameEn: 'F', nameBn: null }, discountPoysha: 6000n },
    });

    await controller.preview(customer, {
      code: 'FREESHIP',
      subtotalPoysha: 100000,
      deliveryFeePoysha: 6000,
    });

    expect(promotions.apply.mock.calls[0][1].deliveryFeePoysha).toBe(6000n);
  });

  it('turns an invalid code into a 404', async () => {
    promotions.apply.mockResolvedValue({
      ok: false,
      status: HttpStatus.NOT_FOUND,
      message: 'That promo code is not valid.',
    });

    await expect(
      controller.preview(customer, { code: 'NOPE', subtotalPoysha: 100000 }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });
});

describe('AdminPromotionController', () => {
  let promotions: { list: jest.Mock; create: jest.Mock; update: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let controller: AdminPromotionController;

  beforeEach(() => {
    promotions = { list: jest.fn(), create: jest.fn(), update: jest.fn() };
    logger = createMockLogger();
    controller = new AdminPromotionController(
      promotions as unknown as AdminPromotionService,
      logger,
    );
  });

  it('restricts campaign management to super admins and marketing', () => {
    expect(new Reflector().get(MetadataKeys.Roles, AdminPromotionController)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.MARKETING,
    ]);
  });

  it('leaves preview open to any signed-in customer', () => {
    expect(new Reflector().get(MetadataKeys.Roles, PromotionController)).toBeUndefined();
  });

  it('defaults paging when no query is given', async () => {
    promotions.list.mockResolvedValue({ ok: true, data: { items: [] } });

    await controller.list();

    expect(promotions.list).toHaveBeenCalledWith(1, 50);
  });

  it('ignores a non-numeric page rather than producing NaN', async () => {
    promotions.list.mockResolvedValue({ ok: true, data: { items: [] } });

    await controller.list('abc', 'xyz');

    expect(promotions.list).toHaveBeenCalledWith(1, 50);
  });

  it('passes the actor through when creating', async () => {
    promotions.create.mockResolvedValue({ ok: true, data: { id: 'promo-1' } });
    const body = {
      code: 'EID25',
      nameEn: 'Eid',
      type: PromotionType.PERCENTAGE,
      value: 25,
      startsAt: '2026-09-01T00:00:00.000Z',
    };

    await controller.create(marketer, body);

    expect(promotions.create).toHaveBeenCalledWith(marketer, body);
  });

  it('turns a duplicate code into a 409', async () => {
    promotions.create.mockResolvedValue({
      ok: false,
      status: HttpStatus.CONFLICT,
      message: 'That promo code already exists.',
    });

    await expect(
      controller.create(marketer, {
        code: 'EID25',
        nameEn: 'Eid',
        type: PromotionType.PERCENTAGE,
        value: 25,
        startsAt: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(HttpException);
  });
});

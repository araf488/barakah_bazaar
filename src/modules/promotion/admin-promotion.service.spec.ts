import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PromotionType, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { AdminPromotionService } from './admin-promotion.service';
import { PromotionRepository } from './promotion.repository';

const staff: AuthenticatedUser = {
  supabaseUserId: 'sub-1',
  role: UserRole.MARKETING,
  email: 'marketing@barakahbazaar.com.bd',
};

const row = (overrides = {}) => ({
  id: 'promo-1',
  code: 'EID25',
  nameEn: 'Eid 25%',
  nameBn: null,
  type: PromotionType.PERCENTAGE,
  value: 25n,
  minSubtotalPoysha: 0n,
  maxDiscountPoysha: null,
  startsAt: new Date('2026-09-01T00:00:00.000Z'),
  endsAt: new Date('2026-09-30T00:00:00.000Z'),
  usageLimit: null,
  perCustomerLimit: null,
  isActive: true,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  ...overrides,
});

const dto = (overrides = {}) => ({
  code: 'eid25',
  nameEn: 'Eid 25%',
  type: PromotionType.PERCENTAGE,
  value: 25,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-30T00:00:00.000Z',
  ...overrides,
});

describe('AdminPromotionService', () => {
  let repository: {
    findByCode: jest.Mock;
    findById: jest.Mock;
    createAudited: jest.Mock;
    updateAudited: jest.Mock;
    findPage: jest.Mock;
  };
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AdminPromotionService;

  beforeEach(() => {
    repository = {
      findByCode: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(row()),
      createAudited: jest.fn().mockResolvedValue(row()),
      updateAudited: jest.fn().mockResolvedValue(row()),
      findPage: jest.fn(),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new AdminPromotionService(
      repository as unknown as PromotionRepository,
      authService as unknown as AuthService,
      logger,
    );
  });

  describe('coherence', () => {
    it('uppercases the code so two cases cannot both exist', async () => {
      await service.create(staff, dto());

      expect(repository.findByCode).toHaveBeenCalledWith('EID25');
      expect(repository.createAudited.mock.calls[0][0].code).toBe('EID25');
    });

    it('refuses a percentage above 100, which would be a payment not a discount', async () => {
      const result = await service.create(staff, dto({ value: 150 }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'A percentage discount must be between 1 and 100.',
      });
      expect(repository.createAudited).not.toHaveBeenCalled();
    });

    it('refuses a percentage of zero', async () => {
      const result = await service.create(staff, dto({ value: 0 }));

      expect(result.ok).toBe(false);
    });

    it('allows a large fixed amount, which is not a percentage', async () => {
      const result = await service.create(
        staff,
        dto({ type: PromotionType.FIXED_AMOUNT, value: 500000 }),
      );

      expect(result.ok).toBe(true);
    });

    it('refuses a cap on a fixed amount, which would silently be ignored', async () => {
      const result = await service.create(
        staff,
        dto({ type: PromotionType.FIXED_AMOUNT, value: 5000, maxDiscountPoysha: 1000 }),
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'A maximum discount only applies to a percentage promotion.',
      });
    });

    it('refuses an end date at or before the start', async () => {
      const result = await service.create(
        staff,
        dto({ startsAt: '2026-09-30T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z' }),
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'The end date must be after the start date.',
      });
    });

    it('allows no end date at all', async () => {
      const result = await service.create(staff, dto({ endsAt: null }));

      expect(result.ok).toBe(true);
      expect(repository.createAudited.mock.calls[0][0].endsAt).toBeNull();
    });
  });

  describe('create', () => {
    it('refuses a code that already exists', async () => {
      repository.findByCode.mockResolvedValue(row());

      const result = await service.create(staff, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That promo code already exists.',
      });
    });

    it('converts money and dates to their stored types', async () => {
      await service.create(staff, dto({ minSubtotalPoysha: 100000, maxDiscountPoysha: 50000 }));

      expect(repository.createAudited.mock.calls[0][0]).toMatchObject({
        value: 25n,
        minSubtotalPoysha: 100000n,
        maxDiscountPoysha: 50000n,
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
      });
    });

    it('defaults an omitted minimum to zero and omitted limits to unlimited', async () => {
      await service.create(staff, dto());

      expect(repository.createAudited.mock.calls[0][0]).toMatchObject({
        minSubtotalPoysha: 0n,
        usageLimit: null,
        perCustomerLimit: null,
      });
    });

    it('refuses the promotion when its audit row cannot be written', async () => {
      repository.createAudited.mockResolvedValue(null);

      const result = await service.create(staff, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not record this change in the audit trail, so it was not applied.',
      });
    });

    it('reports 503 rather than a conflict when the code check fails', async () => {
      repository.findByCode.mockResolvedValue(null);

      const result = await service.create(staff, dto());

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('update', () => {
    it('reports 404 for a promotion that does not exist', async () => {
      repository.findById.mockResolvedValue(undefined);

      const result = await service.update(staff, 'promo-1', dto());

      expect(result.ok === false && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('validates coherence on update too', async () => {
      const result = await service.update(staff, 'promo-1', dto({ value: 150 }));

      expect(result.ok).toBe(false);
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('passes the previous row as the audit before-image', async () => {
      const previous = row({ value: 10n });
      repository.findById.mockResolvedValue(previous);

      await service.update(staff, 'promo-1', dto());

      const audit = repository.updateAudited.mock.calls[0][2] as (r: unknown) => {
        before: { value: number };
      };

      expect(audit(row()).before.value).toBe(10);
    });
  });

  describe('list', () => {
    it('maps money out as numbers', async () => {
      repository.findPage.mockResolvedValue({
        items: [row({ minSubtotalPoysha: 100000n })],
        total: 1,
      });

      const result = await service.list(1, 50);

      expect(result.ok && result.data.items[0]).toMatchObject({
        value: 25,
        minSubtotalPoysha: 100000,
      });
    });

    it('reports 503 when the page cannot be read', async () => {
      repository.findPage.mockResolvedValue(null);

      const result = await service.list(1, 50);

      expect(result.ok).toBe(false);
    });
  });
});

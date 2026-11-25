import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PromotionType } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { PromotionRepository } from './promotion.repository';
import { PromotionService } from './promotion.service';

const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
const hourAhead = () => new Date(Date.now() + 60 * 60 * 1000);

const promo = (overrides = {}) => ({
  id: 'promo-1',
  code: 'EID25',
  nameEn: 'Eid 25%',
  nameBn: null,
  type: PromotionType.PERCENTAGE,
  value: 25n,
  minSubtotalPoysha: 0n,
  maxDiscountPoysha: null,
  startsAt: hourAgo(),
  endsAt: hourAhead(),
  usageLimit: null,
  perCustomerLimit: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const basis = (overrides = {}) => ({
  subtotalPoysha: 100000n,
  deliveryFeePoysha: 6000n,
  userId: 'user-1',
  ...overrides,
});

describe('PromotionService', () => {
  let repository: { findByCode: jest.Mock; countRedemptions: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: PromotionService;

  beforeEach(() => {
    repository = {
      findByCode: jest.fn().mockResolvedValue(promo()),
      countRedemptions: jest.fn().mockResolvedValue({ total: 0, byCustomer: 0 }),
    };
    logger = createMockLogger();
    service = new PromotionService(repository as unknown as PromotionRepository, logger);
  });

  describe('code matching', () => {
    it('matches case-insensitively', async () => {
      await service.apply('eid25', basis());

      expect(repository.findByCode).toHaveBeenCalledWith('EID25');
    });

    it('trims surrounding whitespace', async () => {
      await service.apply('  EID25  ', basis());

      expect(repository.findByCode).toHaveBeenCalledWith('EID25');
    });
  });

  describe('discount arithmetic', () => {
    it('takes a percentage of the subtotal, not of the total', async () => {
      // Delivery is not discounted by a percentage code, or the fee becomes negotiable.
      const result = await service.apply('EID25', basis());

      expect(result.ok && result.data.discountPoysha).toBe(25000n);
    });

    it('caps a percentage at the maximum discount', async () => {
      repository.findByCode.mockResolvedValue(promo({ maxDiscountPoysha: 10000n }));

      const result = await service.apply('EID25', basis());

      expect(result.ok && result.data.discountPoysha).toBe(10000n);
    });

    it('rounds a fractional percentage down, never up past the cap', async () => {
      repository.findByCode.mockResolvedValue(promo({ value: 33n }));

      const result = await service.apply('EID25', basis({ subtotalPoysha: 10n }));

      // 10 * 33 / 100 = 3.3 -> 3
      expect(result.ok && result.data.discountPoysha).toBe(3n);
    });

    it('never lets a percentage exceed the subtotal', async () => {
      repository.findByCode.mockResolvedValue(promo({ value: 100n }));

      const result = await service.apply('EID25', basis());

      expect(result.ok && result.data.discountPoysha).toBe(100000n);
    });

    it('gives a fixed amount as-is', async () => {
      repository.findByCode.mockResolvedValue(
        promo({ type: PromotionType.FIXED_AMOUNT, value: 15000n }),
      );

      const result = await service.apply('EID25', basis());

      expect(result.ok && result.data.discountPoysha).toBe(15000n);
    });

    it('clamps a fixed amount to the subtotal, so the order can never go negative', async () => {
      repository.findByCode.mockResolvedValue(
        promo({ type: PromotionType.FIXED_AMOUNT, value: 999999n }),
      );

      const result = await service.apply('EID25', basis({ subtotalPoysha: 50000n }));

      expect(result.ok && result.data.discountPoysha).toBe(50000n);
    });

    it('discounts exactly the delivery fee for a free-delivery code', async () => {
      repository.findByCode.mockResolvedValue(
        promo({ type: PromotionType.FREE_DELIVERY, value: 0n }),
      );

      const result = await service.apply('EID25', basis({ deliveryFeePoysha: 8000n }));

      expect(result.ok && result.data.discountPoysha).toBe(8000n);
    });

    it('refuses a free-delivery code where delivery is already free', async () => {
      repository.findByCode.mockResolvedValue(
        promo({ type: PromotionType.FREE_DELIVERY, value: 0n }),
      );

      const result = await service.apply('EID25', basis({ deliveryFeePoysha: 0n }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'That promo code does not reduce this order.',
      });
    });
  });

  describe('eligibility', () => {
    it('answers an unknown code and an inactive one identically', async () => {
      repository.findByCode.mockResolvedValue(undefined);
      const unknown = await service.apply('NOPE', basis());

      repository.findByCode.mockResolvedValue(promo({ isActive: false }));
      const inactive = await service.apply('EID25', basis());

      expect(unknown).toEqual(inactive);
      expect(unknown).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'That promo code is not valid.',
      });
    });

    it('refuses a code that has not started', async () => {
      repository.findByCode.mockResolvedValue(promo({ startsAt: hourAhead(), endsAt: null }));

      const result = await service.apply('EID25', basis());

      expect(result.ok).toBe(false);
    });

    it('refuses a code that has ended', async () => {
      repository.findByCode.mockResolvedValue(promo({ startsAt: new Date(0), endsAt: hourAgo() }));

      const result = await service.apply('EID25', basis());

      expect(result.ok).toBe(false);
    });

    it('accepts a code with no end date', async () => {
      repository.findByCode.mockResolvedValue(promo({ endsAt: null }));

      const result = await service.apply('EID25', basis());

      expect(result.ok).toBe(true);
    });

    it('refuses a basket below the minimum', async () => {
      repository.findByCode.mockResolvedValue(promo({ minSubtotalPoysha: 200000n }));

      const result = await service.apply('EID25', basis());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Your basket does not meet the minimum for this promo code.',
      });
    });

    it('accepts a basket exactly at the minimum', async () => {
      repository.findByCode.mockResolvedValue(promo({ minSubtotalPoysha: 100000n }));

      const result = await service.apply('EID25', basis());

      expect(result.ok).toBe(true);
    });
  });

  describe('usage limits', () => {
    it('counts usage from the redemption ledger, never a counter', async () => {
      repository.findByCode.mockResolvedValue(promo({ usageLimit: 100 }));

      await service.apply('EID25', basis());

      expect(repository.countRedemptions).toHaveBeenCalledWith('promo-1', 'user-1');
    });

    it('refuses once the total limit is reached', async () => {
      repository.findByCode.mockResolvedValue(promo({ usageLimit: 100 }));
      repository.countRedemptions.mockResolvedValue({ total: 100, byCustomer: 0 });

      const result = await service.apply('EID25', basis());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This promo code has been fully claimed.',
      });
    });

    it('refuses once this customer has used their allowance', async () => {
      repository.findByCode.mockResolvedValue(promo({ perCustomerLimit: 1 }));
      repository.countRedemptions.mockResolvedValue({ total: 5, byCustomer: 1 });

      const result = await service.apply('EID25', basis());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'You have already used this promo code.',
      });
    });

    it('allows a customer still inside their allowance', async () => {
      repository.findByCode.mockResolvedValue(promo({ perCustomerLimit: 3 }));
      repository.countRedemptions.mockResolvedValue({ total: 50, byCustomer: 2 });

      const result = await service.apply('EID25', basis());

      expect(result.ok).toBe(true);
    });

    it('skips the count entirely when the code is unlimited', async () => {
      await service.apply('EID25', basis());

      expect(repository.countRedemptions).not.toHaveBeenCalled();
    });

    it('reports 503 rather than granting when the count cannot be read', async () => {
      repository.findByCode.mockResolvedValue(promo({ usageLimit: 10 }));
      repository.countRedemptions.mockResolvedValue(null);

      const result = await service.apply('EID25', basis());

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  it('reports 503 rather than an invalid code when the lookup fails', async () => {
    repository.findByCode.mockResolvedValue(null);

    const result = await service.apply('EID25', basis());

    expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});

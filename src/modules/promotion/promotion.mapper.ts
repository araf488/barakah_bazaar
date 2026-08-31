import { Money } from '../../common/money/money';
import { Promotion } from '../../infra/prisma/prisma-client';
import { PromotionDto, PromotionPreviewDto } from './dto/promotion.dto';

export const PromotionMapper = {
  toDto(row: Promotion): PromotionDto {
    return {
      id: row.id,
      code: row.code,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      type: row.type,
      value: Money.toJsonNumber(row.value),
      minSubtotalPoysha: Money.toJsonNumber(row.minSubtotalPoysha),
      maxDiscountPoysha:
        row.maxDiscountPoysha === null ? null : Money.toJsonNumber(row.maxDiscountPoysha),
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      usageLimit: row.usageLimit,
      perCustomerLimit: row.perCustomerLimit,
      isActive: row.isActive,
    };
  },

  /**
   * The customer-facing view of an applied code.
   *
   * Deliberately narrow: it says what this basket saves and nothing about limits, remaining
   * uses or the window, none of which are the customer's business and all of which would help
   * someone probe the promotion catalogue.
   */
  toPreview(row: Promotion, discountPoysha: bigint): PromotionPreviewDto {
    return {
      code: row.code,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      discountPoysha: Money.toJsonNumber(discountPoysha),
    };
  },
} as const;

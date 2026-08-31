import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Promotion, PromotionType } from '../../infra/prisma/prisma-client';
import { PromotionConstants, PromotionMessages } from './promotion.constants';
import { PromotionRepository } from './promotion.repository';

/** What a basket looks like to a promotion. */
export interface DiscountBasis {
  readonly subtotalPoysha: bigint;
  readonly deliveryFeePoysha: bigint;
  readonly userId: string;
}

/** A promotion that applied, and what it was worth. */
export interface AppliedDiscount {
  readonly promotion: Promotion;
  readonly discountPoysha: bigint;
}

/**
 * Promo codes.
 *
 * Two things this service refuses to do. It never counts usage from a column on the promotion
 * — a `timesUsed` counter is how two concurrent checkouts both find room and both oversell it
 * — and it never lets a discount exceed what the customer is actually paying, because a
 * negative total is a refund nobody authorised.
 *
 * The discount is computed here but **recorded by the order transaction**, so a redemption
 * without an order, or an order that claimed a discount without recording it, cannot exist.
 */
@Injectable()
export class PromotionService {
  constructor(
    private readonly repository: PromotionRepository,
    @InjectPinoLogger(PromotionService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Resolves a code to a discount, or explains why it does not apply.
   *
   * Called at checkout for the authoritative amount, and by the storefront to preview one.
   */
  async apply(code: string, basis: DiscountBasis): Promise<ServiceResponse<AppliedDiscount>> {
    try {
      const promotion = await this.repository.findByCode(PromotionService.normalise(code));

      if (promotion === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PromotionMessages.Unavailable);
      }

      const usable = PromotionService.assertUsable(promotion, basis);
      if (usable) {
        return usable;
      }

      const limits = await this.assertWithinLimits(promotion as Promotion, basis.userId);
      if (limits) {
        return limits;
      }

      const discountPoysha = PromotionService.calculate(promotion as Promotion, basis);

      if (discountPoysha <= 0n) {
        return serviceFail(HttpStatus.UNPROCESSABLE_ENTITY, PromotionMessages.NoDiscount);
      }

      return serviceOk({ promotion: promotion as Promotion, discountPoysha });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PromotionService.apply');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * What the code is worth, clamped to what the customer is actually paying.
   *
   * FREE_DELIVERY reduces the delivery fee and nothing else; the other two reduce the goods.
   * Every branch is capped so a discount can never exceed its own base — a promotion must
   * never turn an order into money owed to the customer.
   */
  private static calculate(promotion: Promotion, basis: DiscountBasis): bigint {
    if (promotion.type === PromotionType.FREE_DELIVERY) {
      return basis.deliveryFeePoysha;
    }

    if (promotion.type === PromotionType.FIXED_AMOUNT) {
      return PromotionService.min(promotion.value, basis.subtotalPoysha);
    }

    // Integer division truncates, which rounds in the customer's disfavour by at most one
    // poysha. Deliberate: rounding the other way lets a percentage exceed its cap.
    const raw = (basis.subtotalPoysha * promotion.value) / 100n;
    const capped =
      promotion.maxDiscountPoysha === null
        ? raw
        : PromotionService.min(raw, promotion.maxDiscountPoysha);

    return PromotionService.min(capped, basis.subtotalPoysha);
  }

  /** Everything decidable from the promotion row and the basket alone. */
  private static assertUsable(
    promotion: Promotion | undefined,
    basis: DiscountBasis,
  ): ServiceResponse<never> | null {
    const now = new Date();

    // An unknown code, an inactive one and one outside its window answer identically, so the
    // endpoint cannot be used to enumerate which codes exist.
    if (
      !promotion ||
      !promotion.isActive ||
      promotion.startsAt.getTime() > now.getTime() ||
      (promotion.endsAt !== null && promotion.endsAt.getTime() <= now.getTime())
    ) {
      return serviceFail(HttpStatus.NOT_FOUND, PromotionMessages.NotUsable);
    }

    if (basis.subtotalPoysha < promotion.minSubtotalPoysha) {
      return serviceFail(HttpStatus.UNPROCESSABLE_ENTITY, PromotionMessages.BelowMinimum);
    }

    return null;
  }

  /** Both usage limits, counted from the redemption ledger. */
  private async assertWithinLimits(
    promotion: Promotion,
    userId: string,
  ): Promise<ServiceResponse<never> | null> {
    if (promotion.usageLimit === null && promotion.perCustomerLimit === null) {
      return null;
    }

    const counts = await this.repository.countRedemptions(promotion.id, userId);

    if (counts === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PromotionMessages.Unavailable);
    }

    if (promotion.usageLimit !== null && counts.total >= promotion.usageLimit) {
      return serviceFail(HttpStatus.CONFLICT, PromotionMessages.FullyRedeemed);
    }

    if (promotion.perCustomerLimit !== null && counts.byCustomer >= promotion.perCustomerLimit) {
      return serviceFail(HttpStatus.CONFLICT, PromotionMessages.CustomerLimitReached);
    }

    return null;
  }

  /** Codes are compared uppercased, so EID25 and eid25 are the same code. */
  static normalise(code: string): string {
    return code.trim().toUpperCase().slice(0, PromotionConstants.MaxCodeLength);
  }

  private static min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
  }
}

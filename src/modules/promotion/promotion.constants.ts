export const PromotionConstants = {
  RouteBase: 'promotions',
  AdminRouteBase: 'admin/promotions',
  ResourceName: 'Promotion',
  MaxCodeLength: 32,
  MaxNameLength: 120,
  /** Percentage values are whole percent, 1–100. */
  MinPercent: 1n,
  MaxPercent: 100n,
  DefaultPageSize: 50,
  MaxPageSize: 100,
} as const;

export const PromotionMessages = {
  /** The code does not exist, is inactive, or is outside its window. */
  NotUsable: 'That promo code is not valid.',
  /** The basket is below the promotion's minimum. */
  BelowMinimum: 'Your basket does not meet the minimum for this promo code.',
  /** The promotion has been fully redeemed across all customers. */
  FullyRedeemed: 'This promo code has been fully claimed.',
  /** This customer has used it as many times as they may. */
  CustomerLimitReached: 'You have already used this promo code.',
  /** The code was accepted but works out to no reduction. */
  NoDiscount: 'That promo code does not reduce this order.',
  /** A code that already exists was created again. */
  CodeExists: 'That promo code already exists.',
  /** A percentage outside 1–100. */
  InvalidPercent: 'A percentage discount must be between 1 and 100.',
  /** An end date at or before the start. */
  EndBeforeStart: 'The end date must be after the start date.',
  /** A cap on something that is not a percentage. */
  CapOnlyForPercentage: 'A maximum discount only applies to a percentage promotion.',
  /** The database could not be read or written. */
  Unavailable: 'Could not apply the promo code. Please try again.',
  /** The audit row could not be written, so the change was refused. */
  AuditTrailUnavailable: 'Could not record this change in the audit trail, so it was not applied.',
} as const;

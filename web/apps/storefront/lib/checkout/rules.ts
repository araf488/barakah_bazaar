/** Longest note the API keeps (OrderConstants.MaxCustomerNoteLength). */
export const MAX_NOTE_LENGTH = 500;

/** Longest promo code the API accepts (PromotionConstants.MaxCodeLength). */
export const MAX_PROMO_CODE_LENGTH = 32;

/** What the shopper should expect to pay: never below zero, as the API charges it. */
export const totalOf = (subtotal: number, deliveryFee: number, discount: number): number =>
  Math.max(0, subtotal + deliveryFee - discount);

/**
 * Bangladeshi mobile numbers.
 *
 * Two forms are accepted from clients — the local `01XXXXXXXXX` everyone types
 * and the E.164 `+8801XXXXXXXXX` — and exactly one form is ever stored. The
 * custom OTP flow will look numbers up by the stored value, so a row written
 * in the local form would simply never be found.
 *
 * `1[3-9]` is the issued operator-prefix range; `011`/`012` are not allocated.
 */
export const BANGLADESH_MOBILE_PATTERN = /^(?:\+8801|01)[3-9]\d{8}$/;

/** Digits in a Bangladeshi mobile number after the country code. */
const NATIONAL_NUMBER_LENGTH = 10;

export const BangladeshPhone = {
  isValid(value: string): boolean {
    return BANGLADESH_MOBILE_PATTERN.test(value.trim());
  },

  /**
   * Returns the E.164 form. Assumes `isValid` already passed — callers run it
   * through `@Matches(BANGLADESH_MOBILE_PATTERN)` on the DTO first.
   */
  normalize(value: string): string {
    const digits = value.trim().replace(/\D/g, '');
    return `+880${digits.slice(-NATIONAL_NUMBER_LENGTH)}`;
  },
} as const;

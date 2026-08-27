import { ApplicationConstants } from '../constants/app.constants';

/** Poysha per Taka. Every monetary value in this codebase is integer poysha. */
export const POYSHA_PER_TAKA = 100n;

const GRAMS_PER_KILOGRAM = 1000n;
const ROUNDING_HALF = 500n;

/**
 * Integer-only money helpers.
 *
 * Prices are stored and transported as **poysha** (BigInt) so no rounding
 * error can accumulate through cart maths. Floats never touch a price: the
 * only float boundary is `fromTaka`, which rounds once at the edge.
 */
export const Money = {
  /** Converts a Taka amount (possibly fractional) to integer poysha. */
  fromTaka(taka: number): bigint {
    if (!Number.isFinite(taka)) {
      throw new TypeError('Taka amount must be a finite number.');
    }
    return BigInt(Math.round(taka * Number(POYSHA_PER_TAKA)));
  },

  /**
   * Converts poysha to a Taka number. For display and JSON only — never feed
   * the result back into a calculation.
   */
  toTaka(poysha: bigint): number {
    return Number(poysha) / Number(POYSHA_PER_TAKA);
  },

  /** Widens a poysha value to a plain number for JSON responses. */
  toJsonNumber(poysha: bigint): number {
    return Number(poysha);
  },

  /** Multiplies a unit price by an integer quantity. */
  multiply(poysha: bigint, quantity: number): bigint {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new TypeError('Quantity must be a non-negative integer.');
    }
    return poysha * BigInt(quantity);
  },

  /** Sums poysha amounts. */
  sum(amounts: readonly bigint[]): bigint {
    return amounts.reduce((total, amount) => total + amount, 0n);
  },

  /**
   * Price of `grams` of a product sold by weight, rounded half-up to the
   * nearest poysha. Used for fresh fruit and dry fruit priced per kilogram.
   */
  forWeight(pricePerKilogramPoysha: bigint, grams: number): bigint {
    if (!Number.isInteger(grams) || grams < 0) {
      throw new TypeError('Weight in grams must be a non-negative integer.');
    }
    const scaled = pricePerKilogramPoysha * BigInt(grams);
    return (scaled + ROUNDING_HALF) / GRAMS_PER_KILOGRAM;
  },

  /** Formats poysha as a localized currency string, e.g. "৳1,250.50". */
  format(poysha: bigint, locale: string = ApplicationConstants.DefaultLocale): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: ApplicationConstants.CurrencyCode,
      currencyDisplay: 'narrowSymbol',
    }).format(Money.toTaka(poysha));
  },
} as const;

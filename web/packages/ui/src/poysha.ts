import type { AppLocale } from './locale';

export const TAKA_SIGN = '৳';
export const POYSHA_PER_TAKA = 100;
export const NON_INTEGER_POYSHA_MESSAGE = 'poysha must be an integer';

/**
 * The number system each locale reads prices in. Bangla uses Bengali digits and the lakh
 * grouping Bangladesh writes prices in (১২,৩৪,৫৬৭.৫০), as Chaldal does in Bangla; English keeps
 * Latin digits and thousands grouping, matching the prototype.
 */
const NUMBER_LOCALE: Record<AppLocale, string> = { bn: 'bn-BD', en: 'en-US' };

const TWO_DECIMALS: Record<AppLocale, Intl.NumberFormat> = {
  bn: new Intl.NumberFormat(NUMBER_LOCALE.bn, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  en: new Intl.NumberFormat(NUMBER_LOCALE.en, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

const WHOLE: Record<AppLocale, Intl.NumberFormat> = {
  bn: new Intl.NumberFormat(NUMBER_LOCALE.bn),
  en: new Intl.NumberFormat(NUMBER_LOCALE.en),
};

/**
 * Turns integer poysha into display text in the reader's digits. Throws on a non-integer rather
 * than rounding: a fractional poysha means a float entered the money path upstream, and silently
 * rounding it hides the actual defect.
 */
export const formatPoysha = (poysha: number, locale: AppLocale = 'en'): string => {
  if (!Number.isInteger(poysha)) {
    throw new TypeError(NON_INTEGER_POYSHA_MESSAGE);
  }
  return `${TAKA_SIGN}${TWO_DECIMALS[locale].format(poysha / POYSHA_PER_TAKA)}`;
};

/** A whole count (quantities, badges) in the reader's digits. */
export const formatCount = (value: number, locale: AppLocale = 'en'): string =>
  WHOLE[locale].format(value);

const ONE_DECIMAL: Record<AppLocale, Intl.NumberFormat> = {
  bn: new Intl.NumberFormat(NUMBER_LOCALE.bn, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
  en: new Intl.NumberFormat(NUMBER_LOCALE.en, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
};

/** A rating average (4.5) in the reader's digits. */
export const formatRating = (value: number, locale: AppLocale = 'en'): string =>
  ONE_DECIMAL[locale].format(value);

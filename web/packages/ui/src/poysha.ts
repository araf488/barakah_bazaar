export const TAKA_SIGN = '৳';
export const POYSHA_PER_TAKA = 100;
export const NON_INTEGER_POYSHA_MESSAGE = 'poysha must be an integer';

const GROUPED_TWO_DECIMALS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Turns integer poysha into display text. Throws on a non-integer rather than
 * rounding: a fractional poysha means a float entered the money path upstream,
 * and silently rounding it hides the actual defect.
 */
export const formatPoysha = (poysha: number): string => {
  if (!Number.isInteger(poysha)) {
    throw new TypeError(NON_INTEGER_POYSHA_MESSAGE);
  }
  return `${TAKA_SIGN}${GROUPED_TWO_DECIMALS.format(poysha / POYSHA_PER_TAKA)}`;
};

import type { ProductVariant } from './api/catalog';

/** The variant selected on arrival: the admin's default, else the first listed. */
export const defaultVariant = (variants: ProductVariant[]): ProductVariant | undefined =>
  variants.find((variant) => variant.isDefault) ?? variants[0];

const PERCENT = 100;

/**
 * Whole-percent saving against the compare-at price, for display only (the server prices the
 * order). `null` when there is no compare-at price or it is not higher than the price.
 */
export const savingPercent = (variant: ProductVariant): number | null => {
  const compareAt = variant.compareAtPricePoysha;
  if (!compareAt || compareAt <= variant.pricePoysha) {
    return null;
  }
  return Math.round(((compareAt - variant.pricePoysha) / compareAt) * PERCENT);
};

/** Hours of shelf life at which the page switches from hours to days. */
export const SHELF_LIFE_DAYS_FROM_HOURS = 48;

const HOURS_PER_DAY = 24;

/** Shelf life in the unit a shopper thinks in: hours for doi, days for dates. */
export const shelfLife = (hours: number): { unit: 'hours' | 'days'; value: number } =>
  hours >= SHELF_LIFE_DAYS_FROM_HOURS
    ? { unit: 'days', value: Math.floor(hours / HOURS_PER_DAY) }
    : { unit: 'hours', value: hours };

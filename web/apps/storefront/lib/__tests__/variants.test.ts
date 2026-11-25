import { describe, expect, it } from 'vitest';

import { variant } from '../../test/productDetail';
import { defaultVariant, savingPercent, shelfLife } from '../variants';

describe('defaultVariant', () => {
  it('selects the admin’s default', () => {
    const chosen = defaultVariant([
      variant({ id: 'a', isDefault: false }),
      variant({ id: 'b', isDefault: true }),
    ]);
    expect(chosen?.id).toBe('b');
  });

  it('falls back to the first variant when none is marked default', () => {
    expect(
      defaultVariant([
        variant({ id: 'a', isDefault: false }),
        variant({ id: 'b', isDefault: false }),
      ])?.id,
    ).toBe('a');
  });

  it('has nothing to select when there are no variants', () => {
    expect(defaultVariant([])).toBeUndefined();
  });
});

describe('savingPercent', () => {
  it('rounds the saving against the compare-at price to a whole percent', () => {
    expect(savingPercent(variant({ pricePoysha: 100000, compareAtPricePoysha: 120000 }))).toBe(17);
  });

  it.each([[null], [100000], [90000]])(
    'shows no saving when the compare-at price is %s',
    (compareAtPricePoysha) => {
      expect(savingPercent(variant({ pricePoysha: 100000, compareAtPricePoysha }))).toBeNull();
    },
  );

  it('shows no saving when the API omits the compare-at price', () => {
    const withoutCompareAt = variant({ pricePoysha: 100000 });
    delete withoutCompareAt.compareAtPricePoysha;
    expect(savingPercent(withoutCompareAt)).toBeNull();
  });
});

describe('shelfLife', () => {
  it('counts in hours below two days', () => {
    expect(shelfLife(36)).toEqual({ unit: 'hours', value: 36 });
  });

  it('counts whole days from two days up', () => {
    expect(shelfLife(48)).toEqual({ unit: 'days', value: 2 });
    expect(shelfLife(100)).toEqual({ unit: 'days', value: 4 });
  });
});

import { describe, expect, it } from 'vitest';

import { categoryPath, productPath, ROUTES } from '../routes';

describe('storefront routes', () => {
  it('builds category and product paths from their slugs', () => {
    expect(categoryPath('dates')).toBe('/c/dates');
    expect(productPath('ajwa-dates')).toBe('/p/ajwa-dates');
  });

  it('escapes a slug that is not URL-safe instead of breaking the path', () => {
    expect(productPath('doi/500g')).toBe('/p/doi%2F500g');
  });

  it('keeps every fixed path locale-free, for the i18n Link to prefix', () => {
    for (const path of Object.values(ROUTES)) {
      expect(path).not.toMatch(/^\/(bn|en)(\/|$)/);
    }
  });
});

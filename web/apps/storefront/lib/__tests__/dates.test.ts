import { describe, expect, it } from 'vitest';

import { dateLocaleOf } from '../dates';

describe('dateLocaleOf', () => {
  it('formats Bangla pages with Bangladeshi Bengali and English ones with British English', () => {
    expect(dateLocaleOf('bn')).toBe('bn-BD');
    expect(dateLocaleOf('en')).toBe('en-GB');
  });

  it('passes any other locale through', () => {
    expect(dateLocaleOf('fr')).toBe('fr');
  });
});

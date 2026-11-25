import { describe, expect, it } from 'vitest';

import { homeFilterHref, isSameFilter, parseHomeFilter, toProductFilter } from '../homeFilter';

describe('parseHomeFilter', () => {
  it('shows everything when the query string names no filter', () => {
    expect(parseHomeFilter({})).toEqual({ kind: 'all' });
  });

  it('reads a category slug', () => {
    expect(parseHomeFilter({ category: 'dates' })).toEqual({ kind: 'category', slug: 'dates' });
  });

  it('reads the perishables filter, which wins over a category', () => {
    expect(parseHomeFilter({ fresh: '1', category: 'dates' })).toEqual({ kind: 'fresh' });
  });

  it('takes the first value when a parameter repeats', () => {
    expect(parseHomeFilter({ category: ['doi', 'dates'] })).toEqual({
      kind: 'category',
      slug: 'doi',
    });
  });

  it.each([[''], ['   '], ['x'.repeat(121)]])('ignores the unusable category %#', (value) => {
    expect(parseHomeFilter({ category: value })).toEqual({ kind: 'all' });
  });

  it('ignores any other value of fresh', () => {
    expect(parseHomeFilter({ fresh: 'yes' })).toEqual({ kind: 'all' });
  });
});

describe('homeFilterHref', () => {
  it('links each filter to the home page, scrolled to the grid', () => {
    expect(homeFilterHref({ kind: 'all' })).toEqual({
      pathname: '/',
      query: {},
      hash: 'new-arrivals',
    });
    expect(homeFilterHref({ kind: 'fresh' }).query).toEqual({ fresh: '1' });
    expect(homeFilterHref({ kind: 'category', slug: 'doi' }).query).toEqual({ category: 'doi' });
  });
});

describe('isSameFilter', () => {
  it('matches categories by slug', () => {
    expect(isSameFilter({ kind: 'category', slug: 'doi' }, { kind: 'category', slug: 'doi' })).toBe(
      true,
    );
    expect(
      isSameFilter({ kind: 'category', slug: 'doi' }, { kind: 'category', slug: 'dates' }),
    ).toBe(false);
    expect(isSameFilter({ kind: 'all' }, { kind: 'fresh' })).toBe(false);
  });
});

describe('toProductFilter', () => {
  it('asks the API for eight products, filtered as the visitor chose', () => {
    expect(toProductFilter({ kind: 'all' })).toEqual({ limit: 8 });
    expect(toProductFilter({ kind: 'fresh' })).toEqual({ limit: 8, perishableOnly: true });
    expect(toProductFilter({ kind: 'category', slug: 'doi' })).toEqual({
      limit: 8,
      categorySlug: 'doi',
    });
  });
});

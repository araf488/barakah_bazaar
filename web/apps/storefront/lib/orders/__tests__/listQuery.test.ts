import { describe, expect, it } from 'vitest';

import { orderListQuery, parseOrderListParams, statusOfFilter } from '../listQuery';

describe('parseOrderListParams', () => {
  it('reads a known filter and page', () => {
    expect(parseOrderListParams({ status: 'DELIVERED', page: '3' })).toEqual({
      filter: 'DELIVERED',
      page: 3,
    });
  });

  it('falls back to every order on the first page for anything it does not know', () => {
    expect(parseOrderListParams({})).toEqual({ filter: 'all', page: 1 });
    expect(parseOrderListParams({ status: 'PICKING', page: '0' })).toEqual({
      filter: 'all',
      page: 1,
    });
    expect(parseOrderListParams({ status: 'all', page: '2.5' })).toEqual({
      filter: 'all',
      page: 1,
    });
    expect(parseOrderListParams({ status: 'delivered', page: '-1' })).toEqual({
      filter: 'all',
      page: 1,
    });
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(parseOrderListParams({ status: ['CANCELLED', 'DELIVERED'], page: ['2', '9'] })).toEqual({
      filter: 'CANCELLED',
      page: 2,
    });
  });
});

describe('statusOfFilter', () => {
  it('asks the API for one status, or none for every order', () => {
    expect(statusOfFilter('DISPATCHED')).toBe('DISPATCHED');
    expect(statusOfFilter('all')).toBeNull();
  });
});

describe('orderListQuery', () => {
  it('leaves the defaults out of the address', () => {
    expect(orderListQuery({ filter: 'all', page: 1 })).toEqual({});
    expect(orderListQuery({ filter: 'DELIVERED', page: 1 })).toEqual({ status: 'DELIVERED' });
    expect(orderListQuery({ filter: 'all', page: 2 })).toEqual({ page: '2' });
  });
});

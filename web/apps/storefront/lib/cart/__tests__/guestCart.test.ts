import { describe, expect, it } from 'vitest';

import {
  addGuestLine,
  type GuestLine,
  parseGuestCart,
  serializeGuestCart,
  setGuestQuantity,
} from '../guestCart';

const line = (v: string, q = 1): GuestLine => ({ s: `slug-${v}`, v, q });

describe('guest cart cookie', () => {
  it('round-trips through the cookie', () => {
    const lines = [line('a', 2), line('b')];
    expect(parseGuestCart(serializeGuestCart(lines))).toEqual(lines);
  });

  it.each([
    [undefined],
    [''],
    ['not json'],
    ['{"s":"x"}'],
    ['[{"s":1,"v":"a","q":1}]'],
    ['[{"s":"x","v":"a","q":0}]'],
  ])('reads %s as an empty cart', (raw) => {
    expect(parseGuestCart(raw)).toEqual([]);
  });

  it('trims a tampered cookie: duplicates, oversize quantities, too many lines', () => {
    const many = Array.from({ length: 25 }, (_, i) => line(`v${i}`));
    const raw = JSON.stringify([line('a', 500), line('a', 3), ...many]);

    const parsed = parseGuestCart(raw);

    expect(parsed).toHaveLength(20);
    expect(parsed[0]).toEqual({ s: 'slug-a', v: 'a', q: 99 });
  });
});

describe('addGuestLine', () => {
  it('adds to a line already there, as the API does', () => {
    const result = addGuestLine([line('a', 2)], line('a', 3));
    expect(result).toEqual({ ok: true, lines: [line('a', 5)] });
  });

  it('caps a line at 99', () => {
    const result = addGuestLine([line('a', 98)], line('a', 5));
    expect(result.ok && result.lines[0]?.q).toBe(99);
  });

  it('refuses a 21st different product', () => {
    const full = Array.from({ length: 20 }, (_, i) => line(`v${i}`));
    expect(addGuestLine(full, line('new'))).toEqual({ ok: false, error: 'guestFull' });
  });
});

describe('setGuestQuantity', () => {
  it('sets the quantity', () => {
    expect(setGuestQuantity([line('a', 2)], 'a', 7)).toEqual([line('a', 7)]);
  });

  it('removes the line at zero', () => {
    expect(setGuestQuantity([line('a', 2), line('b')], 'a', 0)).toEqual([line('b')]);
  });
});

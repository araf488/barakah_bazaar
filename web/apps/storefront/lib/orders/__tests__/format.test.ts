import { describe, expect, it } from 'vitest';

import { formatOrderDate, formatOrderMoment } from '../format';

describe('order dates', () => {
  it('writes the date in Dhaka time', () => {
    // 20:30 UTC on the 19th is already the 20th in Dhaka.
    expect(formatOrderDate('2026-11-19T20:30:00Z', 'en')).toBe('20 Nov 2026');
  });

  it('writes a moment with a 12-hour clock in Dhaka time', () => {
    expect(formatOrderMoment('2026-11-19T10:00:00Z', 'en')).toBe('19 Nov, 4:00 pm');
  });

  it('uses Bengali digits on a Bangla page', () => {
    expect(formatOrderDate('2026-11-19T10:00:00Z', 'bn')).toContain('১৯');
    expect(formatOrderMoment('2026-11-19T10:00:00Z', 'bn')).toContain('৪:০০');
  });
});

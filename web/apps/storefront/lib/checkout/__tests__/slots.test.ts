import { describe, expect, it } from 'vitest';

import { slot } from '../../../test/checkout';
import {
  formatSlotDate,
  formatSlotTime,
  groupSlotsByDate,
  NO_SLOT,
  parseSlotValue,
  slotValue,
} from '../slots';

describe('slot values', () => {
  it('names the window and the date, and reads them back', () => {
    const value = slotValue(slot());
    expect(value).toBe('slot-morning|2026-11-20');
    expect(parseSlotValue(value)).toEqual({ slotId: 'slot-morning', date: '2026-11-20' });
  });

  it('reads "no preferred time" and anything malformed as no window', () => {
    expect(parseSlotValue(NO_SLOT)).toBeNull();
    expect(parseSlotValue('slot-morning')).toBeNull();
    expect(parseSlotValue('a|b|c')).toBeNull();
    expect(parseSlotValue('|2026-11-20')).toBeNull();
  });
});

describe('groupSlotsByDate', () => {
  it('groups by date, both in time order', () => {
    const days = groupSlotsByDate([
      slot({ slotId: 'evening', date: '2026-11-21', startMinute: 1080 }),
      slot({ slotId: 'evening', date: '2026-11-20', startMinute: 1080 }),
      slot({ slotId: 'morning', date: '2026-11-20', startMinute: 600 }),
    ]);

    expect(days.map((day) => day.date)).toEqual(['2026-11-20', '2026-11-21']);
    expect(days[0]?.slots.map((s) => s.slotId)).toEqual(['morning', 'evening']);
  });

  it('is empty for no windows', () => {
    expect(groupSlotsByDate([])).toEqual([]);
  });
});

describe('formatting', () => {
  it('writes a window as Dhaka wall-clock times', () => {
    expect(formatSlotTime(600, 720, 'en')).toMatch(/^10:00\s?am\s?[–-]\s?12:00\s?pm$/i);
  });

  it('writes Bengali digits on a Bangla page', () => {
    expect(formatSlotTime(600, 720, 'bn')).toMatch(/১০:০০/);
  });

  it('writes the date with its weekday', () => {
    expect(formatSlotDate('2026-11-20', 'en')).toBe('Fri 20 Nov');
    expect(formatSlotDate('2026-11-20', 'bn')).toMatch(/২০/);
  });
});

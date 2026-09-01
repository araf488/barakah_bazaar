import {
  availableOccurrences,
  cutoffAt,
  occurrenceKey,
  SlotTemplate,
  startOfDay,
  toDateKey,
} from './slot-availability';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const slot = (overrides: Partial<SlotTemplate> = {}): SlotTemplate => ({
  id: 'slot-1',
  startMinute: 9 * 60,
  endMinute: 11 * 60,
  daysOfWeek: EVERY_DAY,
  capacity: 20,
  cutoffMinutes: 60,
  supportsPerishable: false,
  ...overrides,
});

// A Tuesday, 07:00 local.
const tuesday7am = new Date(2026, 8, 1, 7, 0, 0);

describe('occurrenceKey', () => {
  it('is the slot id and the local date, so capacity splits per day', () => {
    expect(occurrenceKey('slot-1', new Date(2026, 8, 1, 23, 30))).toBe('slot-1|2026-09-01');
  });

  it('gives two days of the same window different keys', () => {
    expect(occurrenceKey('slot-1', new Date(2026, 8, 1))).not.toBe(
      occurrenceKey('slot-1', new Date(2026, 8, 2)),
    );
  });
});

describe('toDateKey', () => {
  it('uses local calendar parts, not UTC', () => {
    // 23:30 local on the 1st is the 2nd in UTC for Dhaka (+6). Keying off toISOString would
    // book the van for the wrong day.
    expect(toDateKey(new Date(2026, 8, 1, 23, 30))).toBe('2026-09-01');
  });

  it('pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('startOfDay', () => {
  it('strips the time so two moments on one day compare equal', () => {
    expect(startOfDay(new Date(2026, 8, 1, 23, 59)).getTime()).toBe(
      startOfDay(new Date(2026, 8, 1, 0, 1)).getTime(),
    );
  });
});

describe('cutoffAt', () => {
  it('closes the stated number of minutes before the window opens', () => {
    const cutoff = cutoffAt(new Date(2026, 8, 1), slot({ cutoffMinutes: 60 }));

    expect(cutoff).toEqual(new Date(2026, 8, 1, 8, 0));
  });

  it('closes exactly at the window when there is no cutoff', () => {
    const cutoff = cutoffAt(new Date(2026, 8, 1), slot({ cutoffMinutes: 0 }));

    expect(cutoff).toEqual(new Date(2026, 8, 1, 9, 0));
  });
});

describe('availableOccurrences', () => {
  const none = new Map<string, number>();

  it('offers today when the cutoff has not passed', () => {
    const result = availableOccurrences([slot()], none, tuesday7am, 1, false);

    expect(result).toHaveLength(1);
    expect(toDateKey(result[0].date)).toBe('2026-09-01');
  });

  it('drops today once the cutoff has passed', () => {
    // 08:30 is past the 08:00 cutoff for a 09:00 window.
    const late = new Date(2026, 8, 1, 8, 30);

    expect(availableOccurrences([slot()], none, late, 1, false)).toHaveLength(0);
  });

  it('treats a cutoff that has just landed as closed, not closing', () => {
    const exactly = new Date(2026, 8, 1, 8, 0, 0);

    expect(availableOccurrences([slot()], none, exactly, 1, false)).toHaveLength(0);
  });

  it('still offers tomorrow after today has closed', () => {
    const late = new Date(2026, 8, 1, 8, 30);
    const result = availableOccurrences([slot()], none, late, 2, false);

    expect(result).toHaveLength(1);
    expect(toDateKey(result[0].date)).toBe('2026-09-02');
  });

  it('only offers the weekdays the window runs', () => {
    // From Tuesday, two days covers Tue and Wed. A Sunday-and-Thursday window runs on
    // neither, so nothing is offered.
    expect(
      availableOccurrences([slot({ daysOfWeek: [0, 4] })], none, tuesday7am, 2, false),
    ).toHaveLength(0);
  });

  it('picks up the matching weekday once the range reaches it', () => {
    // Thursday is two days after Tuesday, so a three-day range includes it exactly once.
    const result = availableOccurrences([slot({ daysOfWeek: [0, 4] })], none, tuesday7am, 3, false);

    expect(result.map((o) => toDateKey(o.date))).toEqual(['2026-09-03']);
  });

  it('counts capacity per window per day, not per window', () => {
    // Keyed literally rather than through occurrenceKey: building the input with the
    // function under test would make this pass whatever key format the code chose.
    const booked = new Map([['slot-1|2026-09-01', 20]]);
    const result = availableOccurrences([slot()], booked, tuesday7am, 2, false);

    // Today is full; tomorrow is a different van and still open.
    expect(result).toHaveLength(1);
    expect(toDateKey(result[0].date)).toBe('2026-09-02');
  });

  it('reports how many places are left', () => {
    const booked = new Map([['slot-1|2026-09-01', 18]]);
    const result = availableOccurrences([slot()], booked, tuesday7am, 1, false);

    expect(result[0].remaining).toBe(2);
  });

  it('hides a window with no places left', () => {
    const booked = new Map([['slot-1|2026-09-01', 20]]);

    expect(availableOccurrences([slot()], booked, tuesday7am, 1, false)).toHaveLength(0);
  });

  it('offers only cold-capable windows to a perishable basket', () => {
    // The van is the last link in the cold chain and the easiest to forget.
    const result = availableOccurrences(
      [slot({ id: 'dry' }), slot({ id: 'cold', supportsPerishable: true })],
      none,
      tuesday7am,
      1,
      true,
    );

    expect(result.map((o) => o.slotId)).toEqual(['cold']);
  });

  it('offers cold-capable windows to a dry basket too', () => {
    const result = availableOccurrences(
      [slot({ id: 'dry' }), slot({ id: 'cold', supportsPerishable: true })],
      none,
      tuesday7am,
      1,
      false,
    );

    expect([...result.map((o) => o.slotId)].sort((a, b) => a.localeCompare(b))).toEqual([
      'cold',
      'dry',
    ]);
  });

  it('orders by date then by time of day', () => {
    const result = availableOccurrences(
      [
        slot({ id: 'evening', startMinute: 18 * 60, endMinute: 20 * 60 }),
        slot({ id: 'morning', startMinute: 9 * 60, endMinute: 11 * 60 }),
      ],
      none,
      tuesday7am,
      2,
      false,
    );

    expect(result.map((o) => `${toDateKey(o.date)} ${o.slotId}`)).toEqual([
      '2026-09-01 morning',
      '2026-09-01 evening',
      '2026-09-02 morning',
      '2026-09-02 evening',
    ]);
  });

  it('crosses a month boundary correctly', () => {
    const lastDay = new Date(2026, 8, 30, 7, 0);
    const result = availableOccurrences([slot()], none, lastDay, 2, false);

    expect(result.map((o) => toDateKey(o.date))).toEqual(['2026-09-30', '2026-10-01']);
  });

  it('returns nothing when no windows are configured', () => {
    expect(availableOccurrences([], none, tuesday7am, 7, false)).toEqual([]);
  });
});

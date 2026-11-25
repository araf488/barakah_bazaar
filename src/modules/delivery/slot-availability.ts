/** A slot template, in the shape the availability calculation needs. */
export interface SlotTemplate {
  readonly id: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly daysOfWeek: number[];
  readonly capacity: number;
  readonly cutoffMinutes: number;
  readonly supportsPerishable: boolean;
}

/** One date on which a template runs, with the bookings already taken. */
export interface SlotOccurrence {
  readonly slotId: string;
  /** Midnight of the delivery date, in the shop's local timezone. */
  readonly date: Date;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly remaining: number;
  readonly supportsPerishable: boolean;
}

export const MINUTES_PER_DAY = 24 * 60;

/** Midnight of the given day, so two dates for the same day compare equal. */
export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** The moment orders for this occurrence stop being accepted. */
export const cutoffAt = (date: Date, slot: SlotTemplate): Date =>
  new Date(date.getTime() + (slot.startMinute - slot.cutoffMinutes) * 60_000);

/**
 * Which windows a customer can still choose, over the next `days` days.
 *
 * Occurrences are computed rather than stored. A table of pre-generated dates needs a job to
 * keep extending it, and the shop stops taking orders the day that job stops — a failure mode
 * that is invisible until it is urgent.
 *
 * `bookedByKey` is keyed `slotId|yyyy-mm-dd`, because capacity is per window per DAY: one van
 * doing Tuesday morning is a different van from the one doing Wednesday morning.
 */
export const availableOccurrences = (
  slots: readonly SlotTemplate[],
  bookedByKey: ReadonlyMap<string, number>,
  now: Date,
  days: number,
  needsCold: boolean,
): SlotOccurrence[] => {
  const occurrences: SlotOccurrence[] = [];
  const today = startOfDay(now);

  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(today.getTime());
    date.setDate(date.getDate() + offset);

    occurrences.push(...occurrencesOn(date, slots, bookedByKey, now, needsCold));
  }

  return occurrences.sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.startMinute - b.startMinute,
  );
};

/** Every window still open on one specific date. */
const occurrencesOn = (
  date: Date,
  slots: readonly SlotTemplate[],
  bookedByKey: ReadonlyMap<string, number>,
  now: Date,
  needsCold: boolean,
): SlotOccurrence[] =>
  slots
    .filter((slot) => isOpenOn(slot, date, now, needsCold))
    .map((slot) => ({
      slotId: slot.id,
      date,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      remaining: slot.capacity - (bookedByKey.get(occurrenceKey(slot.id, date)) ?? 0),
      supportsPerishable: slot.supportsPerishable,
    }))
    .filter((occurrence) => occurrence.remaining > 0);

/** Whether one window runs on this date, is still before its cutoff, and suits the basket. */
const isOpenOn = (slot: SlotTemplate, date: Date, now: Date, needsCold: boolean): boolean => {
  // The cold chain's last link is the van. A perishable basket may only take a window that
  // can keep it cold, however convenient the others are.
  if (needsCold && !slot.supportsPerishable) {
    return false;
  }

  if (!slot.daysOfWeek.includes(date.getDay())) {
    return false;
  }

  // Strictly at-or-after closes it: a cutoff that has just landed is closed, not "closing".
  return cutoffAt(date, slot).getTime() > now.getTime();
};

/** The capacity key for one window on one day. */
export const occurrenceKey = (slotId: string, date: Date): string => `${slotId}|${toDateKey(date)}`;

/** `yyyy-mm-dd` in local time. `toISOString` would shift the day across a timezone. */
export const toDateKey = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
};

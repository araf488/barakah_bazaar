import { dateLocaleOf, DHAKA_TIME_ZONE } from '../dates';
import type { SlotOccurrence } from './api';

/** The form value for "no preferred window": the API delivers it whenever the hub is ready. */
export const NO_SLOT = '';

const SLOT_VALUE_SEPARATOR = '|';
const MINUTES_PER_HOUR = 60;
const UTC = 'UTC';

export interface SlotDay {
  date: string;
  slots: SlotOccurrence[];
}

/** One radio value per window and date, since the API needs both to book it. */
export const slotValue = (slot: Pick<SlotOccurrence, 'slotId' | 'date'>): string =>
  `${slot.slotId}${SLOT_VALUE_SEPARATOR}${slot.date}`;

/** The window and date a radio value names, or `null` for "no preference" or anything malformed. */
export const parseSlotValue = (value: string): { slotId: string; date: string } | null => {
  const [slotId, date, ...rest] = value.split(SLOT_VALUE_SEPARATOR);
  return slotId && date && rest.length === 0 ? { slotId, date } : null;
};

/** Windows grouped by date, dates and windows in time order. */
export const groupSlotsByDate = (slots: readonly SlotOccurrence[]): SlotDay[] => {
  const byDate = new Map<string, SlotOccurrence[]>();
  for (const slot of slots) {
    byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      date,
      slots: [...day].sort((a, b) => a.startMinute - b.startMinute),
    }));
};

const clockOf = (minutes: number): Date =>
  new Date(
    Date.UTC(2000, 0, 1, Math.floor(minutes / MINUTES_PER_HOUR), minutes % MINUTES_PER_HOUR),
  );

/** "10:00 am – 12:00 pm" in the reader's digits; the minutes are Dhaka wall-clock time. */
export const formatSlotTime = (startMinute: number, endMinute: number, locale: string): string =>
  new Intl.DateTimeFormat(dateLocaleOf(locale), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: UTC,
  }).formatRange(clockOf(startMinute), clockOf(endMinute));

/** "Fri, 20 Nov" for a yyyy-mm-dd date. */
export const formatSlotDate = (date: string, locale: string): string =>
  new Intl.DateTimeFormat(dateLocaleOf(locale), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: DHAKA_TIME_ZONE,
  }).format(new Date(`${date}T12:00:00+06:00`));

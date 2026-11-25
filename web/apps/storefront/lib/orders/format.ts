import { dateLocaleOf, DHAKA_TIME_ZONE } from '../dates';

/** "19 Nov 2026" for an order's date, in Dhaka time and the reader's digits. */
export const formatOrderDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(dateLocaleOf(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: DHAKA_TIME_ZONE,
  }).format(new Date(iso));

/** "19 Nov, 4:00 pm" for a step in an order's history. */
export const formatOrderMoment = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(dateLocaleOf(locale), {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: DHAKA_TIME_ZONE,
  }).format(new Date(iso));

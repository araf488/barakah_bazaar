import { dateLocaleOf, DHAKA_TIME_ZONE } from '../dates';
import type { Address } from './api';

/** The parts of an address its one-line form uses; an order's delivery address has them too. */
export type PlaceParts = Pick<Address, 'addressLine' | 'area' | 'unit' | 'district' | 'postCode'>;

/** "House 12, Road 4, Banani, Gulshan, Dhaka 1212": the stored place names, most specific first. */
export const placeLine = (address: PlaceParts): string =>
  [address.addressLine, address.area, address.unit, address.district].filter(Boolean).join(', ') +
  (address.postCode ? ` ${address.postCode}` : '');

/** "19 Nov, 4:00 pm" for when a signed-in device was last used, in Dhaka time. */
export const formatDeviceMoment = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(dateLocaleOf(locale), {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: DHAKA_TIME_ZONE,
  }).format(new Date(iso));

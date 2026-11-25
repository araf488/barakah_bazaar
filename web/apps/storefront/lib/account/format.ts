import type { Address } from './api';

/** The parts of an address its one-line form uses; an order's delivery address has them too. */
export type PlaceParts = Pick<Address, 'addressLine' | 'area' | 'unit' | 'district' | 'postCode'>;

/** "House 12, Road 4, Banani, Gulshan, Dhaka 1212": the stored place names, most specific first. */
export const placeLine = (address: PlaceParts): string =>
  [address.addressLine, address.area, address.unit, address.district].filter(Boolean).join(', ') +
  (address.postCode ? ` ${address.postCode}` : '');

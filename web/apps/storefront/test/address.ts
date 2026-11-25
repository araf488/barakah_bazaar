import type { Address } from '../lib/account/api';

export const address = (overrides: Partial<Address> = {}): Address => ({
  id: 'addr-1',
  label: 'Home',
  recipientName: 'Tahmina Rahman',
  phone: '+8801712345678',
  division: 'Dhaka',
  district: 'Dhaka',
  unit: 'Gulshan',
  area: 'Banani',
  addressLine: 'House 12, Road 4',
  postCode: '1213',
  latitude: null,
  longitude: null,
  isDefault: true,
  ...overrides,
});

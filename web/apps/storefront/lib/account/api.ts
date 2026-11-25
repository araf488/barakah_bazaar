import { type CallerContext, callApi } from '../auth/api';

// Server-side client for the API's address book (src/modules/user/address.controller.ts).

export interface Address {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  unit: string;
  area: string | null;
  addressLine: string;
  postCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
}

/** What the form sends; place names are the geo API's English names, as the API validates them. */
export interface AddressInput {
  label?: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  unit: string;
  area?: string;
  addressLine: string;
  postCode?: string;
  unlistedLocation?: boolean;
}

const ADDRESSES_PATH = '/users/me/addresses';
const one = (id: string) => `${ADDRESSES_PATH}/${encodeURIComponent(id)}`;

export const addressApi = {
  list: (caller: CallerContext) => callApi<Address[]>('GET', ADDRESSES_PATH, caller),
  create: (caller: CallerContext, input: AddressInput) =>
    callApi<Address>('POST', ADDRESSES_PATH, caller, input),
  update: (caller: CallerContext, id: string, input: AddressInput) =>
    callApi<Address>('PATCH', one(id), caller, input),
  remove: (caller: CallerContext, id: string) => callApi<undefined>('DELETE', one(id), caller),
  setDefault: (caller: CallerContext, id: string) =>
    callApi<Address>('PUT', `${one(id)}/default`, caller),
};

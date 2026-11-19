import { type Address, addressApi } from './api';
import { accountCaller } from './caller';

export type AddressBook = { ok: true; addresses: Address[] } | { ok: false };

/** The signed-in customer's addresses, default first; a failure is a value, not an error page. */
export const getAddressBook = async (): Promise<AddressBook> => {
  const caller = await accountCaller();
  if (!caller) {
    return { ok: false };
  }
  const result = await addressApi.list(caller);
  if (!result.ok) {
    return { ok: false };
  }
  const addresses = [...result.data].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return { ok: true, addresses };
};

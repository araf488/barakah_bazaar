import type { Address } from '../account/api';
import { getAddressBook } from '../account/addresses';
import { accountCaller } from '../account/caller';
import { getCart } from '../cart/getCart';
import type { CartView } from '../cart/view';
import { type QuoteOutcome, quoteFor, type SlotsOutcome, slotsFor } from './delivery';

export interface CheckoutData {
  cart: CartView;
  /** `null` when the address book could not be read. */
  addresses: Address[] | null;
  /** The address the page delivers to: the one asked for, else the default (listed first). */
  selected: Address | null;
  /** Both `null` until there is an address to quote. */
  quote: QuoteOutcome | null;
  slots: SlotsOutcome | null;
}

/** Everything the checkout page shows, for the address in `?address=` or the default one. */
export const getCheckout = async (
  requestedAddressId: string | undefined,
): Promise<CheckoutData> => {
  const [cart, book, caller] = await Promise.all([getCart(), getAddressBook(), accountCaller()]);
  const addresses = book.ok ? book.addresses : null;
  const selected =
    addresses?.find((address) => address.id === requestedAddressId) ?? addresses?.[0] ?? null;
  if (!selected || !caller || cart.lines.length === 0) {
    return { cart, addresses, selected, quote: null, slots: null };
  }
  const [quote, slots] = await Promise.all([
    quoteFor(caller, selected, cart.subtotalPoysha),
    slotsFor(caller, selected.id),
  ]);
  return { cart, addresses, selected, quote, slots };
};

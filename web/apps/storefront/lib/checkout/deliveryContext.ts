import { cache } from 'react';

import { getAddressBook } from '../account/addresses';
import { accountCaller } from '../account/caller';
import { getCart } from '../cart/getCart';
import { quoteFor } from './delivery';

/** Where a signed-in shopper's default address is, and what delivering their cart there costs. */
export interface DeliveryContext {
  /** The most specific stored place name: the area, else the upazila or thana. */
  place: string;
  /** `null` when the cart is empty or the quote failed. */
  feePoysha: number | null;
  isFree: boolean;
  /** How much more the cart needs for free delivery; 0 when free already or never free. */
  shortfallPoysha: number;
}

/**
 * The header's delivery area and the cart's free-delivery nudge, from the default address.
 * `null` for a guest or a shopper with no saved address. Cached per request.
 */
export const getDeliveryContext = cache(async (): Promise<DeliveryContext | null> => {
  const [caller, cart, book] = await Promise.all([accountCaller(), getCart(), getAddressBook()]);
  const address = book.ok ? book.addresses[0] : undefined;
  if (!caller || !address || cart.mode !== 'account') {
    return null;
  }
  const place = address.area ?? address.unit;
  const quote = cart.lines.length > 0 ? await quoteFor(caller, address, cart.subtotalPoysha) : null;
  if (!quote?.ok) {
    return { place, feePoysha: null, isFree: false, shortfallPoysha: 0 };
  }
  return {
    place,
    feePoysha: quote.quote.feePoysha,
    isFree: quote.quote.isFree,
    shortfallPoysha: quote.quote.freeDeliveryShortfallPoysha,
  };
});

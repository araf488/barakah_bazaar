/** Message keys under `checkout.errors`. */
export type CheckoutErrorKey =
  | 'cartEmpty'
  | 'addressGone'
  | 'pricesChanged'
  | 'stock'
  | 'noWarehouse'
  | 'keepCold'
  | 'noZone'
  | 'slotGone'
  | 'promoInvalid'
  | 'promoMinimum'
  | 'promoUsedUp'
  | 'promoAlreadyUsed'
  | 'promoNoDiscount'
  | 'noAddress'
  | 'signedOut'
  | 'unavailable'
  | 'failed';

/**
 * Fragments of the API's English refusal messages (src/modules/order|delivery|promotion
 * constants), each naming the one refusal it belongs to. Several refusals share a status (409
 * covers an empty basket, moved prices, low stock, a full slot and a used-up code), so the
 * message is the only way to give the shopper the right instruction in their own language.
 * Checked in order; the first match wins.
 */
const MESSAGE_FRAGMENTS: ReadonlyArray<readonly [string, CheckoutErrorKey]> = [
  ['basket is empty', 'cartEmpty'],
  ['address is no longer available', 'addressGone'],
  ['prices have changed', 'pricesChanged'],
  ['left in stock', 'stock'],
  ['needs to stay cold', 'keepCold'],
  ['cannot deliver to that address right now', 'noWarehouse'],
  ['not available to that address yet', 'noZone'],
  ['delivery slot', 'slotGone'],
  ['promo code is not valid', 'promoInvalid'],
  ['minimum for this promo code', 'promoMinimum'],
  ['fully claimed', 'promoUsedUp'],
  ['already used this promo code', 'promoAlreadyUsed'],
  ['does not reduce this order', 'promoNoDiscount'],
];

const UNAUTHORIZED = 401;
const SERVICE_UNAVAILABLE = 503;
const UNREACHABLE = 0;

/** The message key for a checkout refusal: by the API's message first, then by its status. */
export const checkoutErrorFor = (status: number, message: string | null): CheckoutErrorKey => {
  const known = message
    ? MESSAGE_FRAGMENTS.find(([fragment]) => message.includes(fragment))
    : undefined;
  if (known) {
    return known[1];
  }
  if (status === UNAUTHORIZED) return 'signedOut';
  if (status === SERVICE_UNAVAILABLE || status === UNREACHABLE) return 'unavailable';
  return 'failed';
};

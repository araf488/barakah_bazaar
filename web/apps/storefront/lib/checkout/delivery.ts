import type { Address } from '../account/api';
import type { CallerContext } from '../auth/api';
import { checkoutApi, type DeliveryQuote, type SlotOccurrence } from './api';
import { type CheckoutErrorKey, checkoutErrorFor } from './errors';

export type QuoteOutcome =
  { ok: true; quote: DeliveryQuote } | { ok: false; error: CheckoutErrorKey };

export type SlotsOutcome =
  { ok: true; slots: SlotOccurrence[] } | { ok: false; error: CheckoutErrorKey };

/** The delivery fee for one address and basket value; a refusal is a value, never a throw. */
export const quoteFor = async (
  caller: CallerContext,
  address: Pick<Address, 'division' | 'district' | 'unit'>,
  subtotalPoysha: number,
): Promise<QuoteOutcome> => {
  const result = await checkoutApi.quote(
    caller,
    { division: address.division, district: address.district, unit: address.unit },
    subtotalPoysha,
  );
  return result.ok
    ? { ok: true, quote: result.data }
    : { ok: false, error: checkoutErrorFor(result.status, result.message) };
};

/**
 * The windows this basket can be delivered in to one address. The API refuses (with the reason)
 * when no hub can serve the basket there, which is also why an order there would fail.
 */
export const slotsFor = async (caller: CallerContext, addressId: string): Promise<SlotsOutcome> => {
  const result = await checkoutApi.slots(caller, addressId);
  return result.ok
    ? { ok: true, slots: result.data }
    : { ok: false, error: checkoutErrorFor(result.status, result.message) };
};

'use server';

import { refresh, revalidatePath } from 'next/cache';

import { getLocale } from 'next-intl/server';

import type { StorefrontLocale } from '../../i18n/messages';
import { redirect } from '../../i18n/navigation';
import { accountCaller } from '../account/caller';
import { orderPlacedPath } from '../routes';
import { checkoutApi, type PlaceOrderInput, type PromotionPreview } from './api';
import { type CheckoutErrorKey, checkoutErrorFor } from './errors';
import { MAX_NOTE_LENGTH, MAX_PROMO_CODE_LENGTH } from './rules';
import { parseSlotValue } from './slots';

export type PromoState =
  | { status: 'idle' }
  | { status: 'applied'; promo: PromotionPreview }
  | { status: 'error'; error: CheckoutErrorKey };

export type PlaceOrderState =
  { status: 'idle' } | { status: 'error'; error: CheckoutErrorKey; at: number };

const REMOVE_INTENT = 'remove';

const field = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

const poyshaOf = (form: FormData, name: string): number => {
  const value = Number(form.get(name));
  return Number.isInteger(value) && value >= 0 ? value : 0;
};

/**
 * Checks a promo code against the basket on the page. The amounts come from the page, so this is
 * a preview only: placing the order prices the code again from the server's own basket and fee.
 */
export async function previewPromoAction(_prev: PromoState, form: FormData): Promise<PromoState> {
  if (form.get('intent') === REMOVE_INTENT) {
    return { status: 'idle' };
  }
  const code = field(form, 'code').toUpperCase().slice(0, MAX_PROMO_CODE_LENGTH);
  if (!code) {
    return { status: 'error', error: 'promoInvalid' };
  }
  const caller = await accountCaller();
  if (!caller) {
    return { status: 'error', error: 'signedOut' };
  }
  const result = await checkoutApi.previewPromotion(
    caller,
    code,
    poyshaOf(form, 'subtotalPoysha'),
    poyshaOf(form, 'deliveryFeePoysha'),
  );
  return result.ok
    ? { status: 'applied', promo: result.data }
    : { status: 'error', error: checkoutErrorFor(result.status, result.message) };
}

const orderInputOf = (form: FormData): PlaceOrderInput => {
  const slot = parseSlotValue(field(form, 'slot'));
  const promotionCode = field(form, 'promotionCode');
  const customerNote = field(form, 'customerNote').slice(0, MAX_NOTE_LENGTH);
  return {
    addressId: field(form, 'addressId'),
    // Cash on delivery only, for now: bKash waits on its payment-result page.
    paymentMethod: 'CASH_ON_DELIVERY',
    ...(slot ? { deliverySlotId: slot.slotId, deliveryDate: slot.date } : {}),
    ...(promotionCode ? { promotionCode } : {}),
    ...(customerNote ? { customerNote } : {}),
    ...(form.get('acceptPriceChanges') === 'on' ? { acceptPriceChanges: true } : {}),
  };
};

/**
 * Places the order and opens its confirmation page. A refusal redraws the page (the basket, fee
 * or windows it was about have changed) and says what to do in the shopper's language.
 */
export async function placeOrderAction(
  _prev: PlaceOrderState,
  form: FormData,
): Promise<PlaceOrderState> {
  const input = orderInputOf(form);
  if (!input.addressId) {
    return { status: 'error', error: 'noAddress', at: Date.now() };
  }
  const caller = await accountCaller();
  if (!caller) {
    return { status: 'error', error: 'signedOut', at: Date.now() };
  }
  const result = await checkoutApi.place(caller, input);
  if (!result.ok) {
    refresh();
    return {
      status: 'error',
      error: checkoutErrorFor(result.status, result.message),
      at: Date.now(),
    };
  }
  // The cart is now empty; without this the header and drawer keep the old one, because the
  // router reuses the cached layout across the redirect.
  revalidatePath('/', 'layout');
  return redirect({
    href: orderPlacedPath(result.data.id),
    locale: (await getLocale()) as StorefrontLocale,
  });
}

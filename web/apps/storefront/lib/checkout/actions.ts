'use server';

import { refresh, revalidatePath } from 'next/cache';
import { redirect as redirectAway } from 'next/navigation';

import { getLocale } from 'next-intl/server';

import type { StorefrontLocale } from '../../i18n/messages';
import { redirect } from '../../i18n/navigation';
import { accountCaller } from '../account/caller';
import type { CallerContext } from '../auth/api';
import { paymentsApi } from '../payments/api';
import { paymentErrorFor } from '../payments/errors';
import { getPaymentMethods } from '../payments/methods';
import { BKASH, isNavigableUrl, parsePaymentMethod } from '../payments/rules';
import { orderPlacedPath } from '../routes';
import { checkoutApi, type Order, type PlaceOrderInput, type PromotionPreview } from './api';
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
    paymentMethod: parsePaymentMethod(form.get('paymentMethod')),
    ...(slot ? { deliverySlotId: slot.slotId, deliveryDate: slot.date } : {}),
    ...(promotionCode ? { promotionCode } : {}),
    ...(customerNote ? { customerNote } : {}),
    ...(form.get('acceptPriceChanges') === 'on' ? { acceptPriceChanges: true } : {}),
  };
};

const placeRefusal = (error: CheckoutErrorKey): PlaceOrderState => ({
  status: 'error',
  error,
  at: Date.now(),
});

/**
 * After a bKash order is placed, sends the browser to bKash's page. When the payment cannot start
 * the order still exists, so its confirmation page opens with the reason and a way to pay again or
 * switch to cash on delivery.
 */
const startBkashPayment = async (caller: CallerContext, order: Order): Promise<never> => {
  const started = await paymentsApi.startBkash(caller, order.id);
  if (started.ok && isNavigableUrl(started.data.redirectUrl)) {
    return redirectAway(started.data.redirectUrl);
  }
  return redirect({
    href: {
      pathname: orderPlacedPath(order.id),
      query: {
        payment: started.ok ? 'gateway' : paymentErrorFor(started.status, started.message),
      },
    },
    locale: (await getLocale()) as StorefrontLocale,
  });
};

/**
 * Places the order. Cash on delivery opens its confirmation page; bKash goes on to bKash's page.
 * A refusal redraws the page (the basket, fee or windows it was about have changed) and says what
 * to do in the shopper's language.
 */
export async function placeOrderAction(
  _prev: PlaceOrderState,
  form: FormData,
): Promise<PlaceOrderState> {
  const input = orderInputOf(form);
  if (!input.addressId) {
    return placeRefusal('noAddress');
  }
  const caller = await accountCaller();
  if (!caller) {
    return placeRefusal('signedOut');
  }
  if (input.paymentMethod === BKASH && !(await getPaymentMethods()).includes(BKASH)) {
    return placeRefusal('bkashUnavailable');
  }
  const result = await checkoutApi.place(caller, input);
  if (!result.ok) {
    refresh();
    return placeRefusal(checkoutErrorFor(result.status, result.message));
  }
  // The cart is now empty; without this the header and drawer keep the old one, because the
  // router reuses the cached layout across the redirect.
  revalidatePath('/', 'layout');
  if (input.paymentMethod === BKASH) {
    return startBkashPayment(caller, result.data);
  }
  return redirect({
    href: orderPlacedPath(result.data.id),
    locale: (await getLocale()) as StorefrontLocale,
  });
}

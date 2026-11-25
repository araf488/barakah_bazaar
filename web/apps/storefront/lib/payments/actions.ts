'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';

import { accountCaller } from '../account/caller';
import { paymentsApi } from './api';
import { type PaymentErrorKey, paymentErrorFor } from './errors';
import { isNavigableUrl, SWITCH_TO_COD_INTENT } from './rules';

export type OrderPaymentState =
  | { status: 'idle' }
  | { status: 'switched' }
  | { status: 'error'; error: PaymentErrorKey; at: number };

const refused = (error: PaymentErrorKey): OrderPaymentState => ({
  status: 'error',
  error,
  at: Date.now(),
});

/** Moves the order to cash on delivery; the page redraws to show it. */
const switchToCod = async (orderId: string): Promise<OrderPaymentState> => {
  const caller = await accountCaller();
  if (!caller) {
    return refused('signedOut');
  }
  const result = await paymentsApi.switchToCod(caller, orderId);
  refresh();
  return result.ok
    ? { status: 'switched' }
    : refused(paymentErrorFor(result.status, result.message));
};

/** Opens a bKash attempt and sends the browser to bKash's page, or says why it could not. */
const payWithBkash = async (orderId: string): Promise<OrderPaymentState> => {
  const caller = await accountCaller();
  if (!caller) {
    return refused('signedOut');
  }
  const result = await paymentsApi.startBkash(caller, orderId);
  if (result.ok && isNavigableUrl(result.data.redirectUrl)) {
    return redirect(result.data.redirectUrl);
  }
  // The order may have moved on (paid, cancelled, its window closed); show where it is now.
  refresh();
  return refused(result.ok ? 'gateway' : paymentErrorFor(result.status, result.message));
};

/**
 * Paying an unpaid bKash order: again with bKash (a new attempt on bKash's page), or by moving it
 * to cash on delivery. The order comes from the form and the API checks it is the shopper's own.
 */
export async function orderPaymentAction(
  _prev: OrderPaymentState,
  form: FormData,
): Promise<OrderPaymentState> {
  const orderId = String(form.get('orderId') ?? '').trim();
  if (!orderId) {
    return refused('gone');
  }
  return form.get('intent') === SWITCH_TO_COD_INTENT ? switchToCod(orderId) : payWithBkash(orderId);
}

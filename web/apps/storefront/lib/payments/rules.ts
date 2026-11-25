import type { Order, PaymentMethod } from '../checkout/api';

export const CASH_ON_DELIVERY: PaymentMethod = 'CASH_ON_DELIVERY';
export const BKASH: PaymentMethod = 'BKASH';

/** The payment form's `intent` that moves the order to cash on delivery instead of paying. */
export const SWITCH_TO_COD_INTENT = 'cod';

/** The method a checkout form asked for; anything unknown is cash on delivery. */
export const parsePaymentMethod = (value: unknown): PaymentMethod =>
  value === BKASH ? BKASH : CASH_ON_DELIVERY;

/**
 * Whether the shopper can still pay this order with bKash, or move it to cash: a bKash order the
 * shop has not confirmed and nobody has paid. The API makes the final call (the payment window may
 * have closed), and says why when it refuses.
 */
export const awaitsBkashPayment = (
  order: Pick<Order, 'paymentMethod' | 'paymentStatus' | 'status'>,
): boolean =>
  order.paymentMethod === BKASH && order.status === 'PLACED' && order.paymentStatus !== 'PAID';

/**
 * Where a payment may send the browser: bKash's hosted page, over http(s) only, so a broken or
 * hostile answer can never become a `javascript:` or `data:` navigation.
 */
export const isNavigableUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

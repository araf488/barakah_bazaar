'use server';

import { refresh } from 'next/cache';

import { accountCaller } from '../account/caller';
import { ordersApi } from './api';
import { type CancelErrorKey, cancelErrorFor } from './errors';
import { MAX_CANCEL_REASON_LENGTH } from './rules';

export type CancelOrderState =
  | { status: 'idle' }
  | { status: 'cancelled' }
  | { status: 'error'; error: CancelErrorKey; at: number };

const field = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

/**
 * Cancels one of the shopper's orders, with the reason they gave if any. Either way the page is
 * drawn again from the API, so it shows where the order really is: cancelled, or already moved
 * on when the refusal says it is too late.
 */
export async function cancelOrderAction(
  _prev: CancelOrderState,
  form: FormData,
): Promise<CancelOrderState> {
  const orderId = field(form, 'orderId');
  if (!orderId) {
    return { status: 'error', error: 'gone', at: Date.now() };
  }
  const caller = await accountCaller();
  if (!caller) {
    return { status: 'error', error: 'signedOut', at: Date.now() };
  }
  const reason = field(form, 'reason').slice(0, MAX_CANCEL_REASON_LENGTH);
  const result = await ordersApi.cancel(caller, orderId, reason || null);
  refresh();
  return result.ok
    ? { status: 'cancelled' }
    : { status: 'error', error: cancelErrorFor(result.status, result.message), at: Date.now() };
}

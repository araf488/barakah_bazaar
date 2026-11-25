import { cache } from 'react';

import { accountCaller } from '../account/caller';
import type { PaymentMethod } from '../checkout/api';
import { paymentsApi } from './api';

/** What checkout offers when the API cannot say: cash, never a method that may refuse. */
const CASH_ONLY: PaymentMethod[] = ['CASH_ON_DELIVERY'];

/**
 * The payment methods checkout may offer, once per request. Without a session or an answer it
 * falls back to cash on delivery alone: offering bKash when its gateway is off would place an
 * order nobody can pay.
 */
export const getPaymentMethods = cache(async (): Promise<PaymentMethod[]> => {
  const caller = await accountCaller();
  if (!caller) {
    return CASH_ONLY;
  }
  const result = await paymentsApi.methods(caller);
  return result.ok && result.data.methods.length > 0 ? result.data.methods : CASH_ONLY;
});

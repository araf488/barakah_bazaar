import { type CallerContext, callApiExplained } from '../auth/api';
import type { Order, PaymentMethod } from '../checkout/api';

// Server-side client for paying an order (src/modules/payment/bkash.controller.ts) and moving it
// to cash on delivery (PATCH /orders/:id/payment-method in src/modules/order).

/** `PaymentMethodsDto`: cash on delivery always, bKash only when its gateway is configured. */
export interface PaymentMethods {
  methods: PaymentMethod[];
}

/** `BkashCheckoutStartedDto`: bKash's hosted page and how long the attempt stays open. */
export interface BkashCheckoutStarted {
  redirectUrl: string;
  expiresInSeconds: number;
}

const ORDERS_PATH = '/orders';
const COD: PaymentMethod = 'CASH_ON_DELIVERY';

export const paymentsApi = {
  methods: (caller: CallerContext) =>
    callApiExplained<PaymentMethods>('GET', '/payments/methods', caller),
  startBkash: (caller: CallerContext, orderId: string) =>
    callApiExplained<BkashCheckoutStarted>(
      'POST',
      `${ORDERS_PATH}/${encodeURIComponent(orderId)}/payments/bkash`,
      caller,
    ),
  switchToCod: (caller: CallerContext, orderId: string) =>
    callApiExplained<Order>(
      'PATCH',
      `${ORDERS_PATH}/${encodeURIComponent(orderId)}/payment-method`,
      caller,
      { paymentMethod: COD },
    ),
};

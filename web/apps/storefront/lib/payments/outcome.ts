/** The words the API's bKash callback puts in `?outcome=` (BkashOutcome in the payment module). */
export const PAYMENT_OUTCOMES = ['paid', 'failed', 'cancelled', 'pending'] as const;

export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

export interface PaymentResultParams {
  /** The order number, e.g. `BB-20261125-000042`, or `null` when bKash sent none we know. */
  orderNumber: string | null;
  outcome: PaymentOutcome;
}

/** Longest order number accepted from the address bar; real ones are about 18 characters. */
const MAX_ORDER_NUMBER_LENGTH = 40;
const ORDER_NUMBER_PATTERN = /^[A-Z0-9-]+$/;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The result page's query. An unknown outcome reads as `failed`: the page then offers to try
 * again, which is safe, while claiming a payment went through never is.
 */
export const parsePaymentResult = (search: {
  order?: string | string[];
  outcome?: string | string[];
}): PaymentResultParams => {
  const order = first(search.order);
  const outcome = first(search.outcome);
  return {
    orderNumber:
      order && order.length <= MAX_ORDER_NUMBER_LENGTH && ORDER_NUMBER_PATTERN.test(order)
        ? order
        : null,
    outcome: PAYMENT_OUTCOMES.find((word) => word === outcome) ?? 'failed',
  };
};

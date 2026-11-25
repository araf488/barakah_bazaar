/** Message keys under `payment.errors`. */
export type PaymentErrorKey =
  | 'notBkash'
  | 'notPayable'
  | 'alreadyPaid'
  | 'windowClosed'
  | 'tooManyAttempts'
  | 'bkashUnavailable'
  | 'gateway'
  | 'cannotSwitch'
  | 'tooFast'
  | 'signedOut'
  | 'gone'
  | 'unavailable'
  | 'failed';

/** Every key, for checking a key that arrives in a URL. */
export const PAYMENT_ERROR_KEYS: readonly PaymentErrorKey[] = [
  'notBkash',
  'notPayable',
  'alreadyPaid',
  'windowClosed',
  'tooManyAttempts',
  'bkashUnavailable',
  'gateway',
  'cannotSwitch',
  'tooFast',
  'signedOut',
  'gone',
  'unavailable',
  'failed',
];

/**
 * Fragments of the API's English refusals for paying or switching an order (PaymentMessages in
 * src/modules/payment/payment.constants.ts, OrderMessages.CannotSwitchToCod). Several share 409
 * or 503, so only the message tells them apart. Checked in order; the first match wins.
 */
const MESSAGE_FRAGMENTS: ReadonlyArray<readonly [string, PaymentErrorKey]> = [
  ['not paid by bKash', 'notBkash'],
  ['can no longer be paid', 'notPayable'],
  ['already been paid', 'alreadyPaid'],
  ['time to pay for this order has passed', 'windowClosed'],
  ['limit of bKash payment attempts', 'tooManyAttempts'],
  ['bKash payment is not available', 'bkashUnavailable'],
  ['bKash could not start the payment', 'gateway'],
  ['can no longer switch to cash on delivery', 'cannotSwitch'],
];

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;
const BAD_GATEWAY = 502;
const SERVICE_UNAVAILABLE = 503;
const UNREACHABLE = 0;

const BY_STATUS: Readonly<Record<number, PaymentErrorKey>> = {
  [UNAUTHORIZED]: 'signedOut',
  [NOT_FOUND]: 'gone',
  [TOO_MANY_REQUESTS]: 'tooFast',
  [BAD_GATEWAY]: 'gateway',
  [SERVICE_UNAVAILABLE]: 'unavailable',
  [UNREACHABLE]: 'unavailable',
};

/** The message key for a refused payment or switch: by the API's message, then its status. */
export const paymentErrorFor = (status: number, message: string | null): PaymentErrorKey => {
  const known = message
    ? MESSAGE_FRAGMENTS.find(([fragment]) => message.includes(fragment))
    : undefined;
  return known ? known[1] : (BY_STATUS[status] ?? 'failed');
};

/** A key read from the address bar, or `null` when it is not one of ours. */
export const parsePaymentErrorKey = (value: unknown): PaymentErrorKey | null =>
  PAYMENT_ERROR_KEYS.find((key) => key === value) ?? null;

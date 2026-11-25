/** Message keys under `orders.cancel.errors`. */
export type CancelErrorKey =
  'tooLate' | 'changed' | 'gone' | 'signedOut' | 'unavailable' | 'failed';

/**
 * Fragments of the API's English refusals for a cancellation (OrderMessages in
 * src/modules/order/order.constants.ts). Both mean 409, so only the message tells them apart.
 * Checked in order; the first match wins.
 */
const MESSAGE_FRAGMENTS: ReadonlyArray<readonly [string, CancelErrorKey]> = [
  ['can no longer be cancelled', 'tooLate'],
  ['cannot go from', 'tooLate'],
  ['changed while you were working on it', 'changed'],
];

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const SERVICE_UNAVAILABLE = 503;
const UNREACHABLE = 0;

/** The message key for a refused cancellation: by the API's message first, then its status. */
export const cancelErrorFor = (status: number, message: string | null): CancelErrorKey => {
  const known = message
    ? MESSAGE_FRAGMENTS.find(([fragment]) => message.includes(fragment))
    : undefined;
  if (known) {
    return known[1];
  }
  if (status === UNAUTHORIZED) return 'signedOut';
  if (status === NOT_FOUND) return 'gone';
  if (status === SERVICE_UNAVAILABLE || status === UNREACHABLE) return 'unavailable';
  return 'failed';
};

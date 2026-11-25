import { describe, expect, it } from 'vitest';

import { parsePaymentErrorKey, paymentErrorFor } from '../errors';

describe('paymentErrorFor', () => {
  it.each([
    ['This order is not paid by bKash.', 'notBkash'],
    ['This order can no longer be paid.', 'notPayable'],
    ['This order has already been paid.', 'alreadyPaid'],
    ['The time to pay for this order has passed.', 'windowClosed'],
    [
      'This order has reached its limit of bKash payment attempts. Try again later, or switch it to cash on delivery.',
      'tooManyAttempts',
    ],
    ['This order can no longer switch to cash on delivery.', 'cannotSwitch'],
  ])('reads the 409 "%s" as %s', (message, key) => {
    expect(paymentErrorFor(409, message)).toBe(key);
  });

  it('tells the 503s and the 502 apart by their message', () => {
    expect(paymentErrorFor(503, 'bKash payment is not available right now.')).toBe(
      'bkashUnavailable',
    );
    expect(paymentErrorFor(503, 'Could not process the payment. Please try again.')).toBe(
      'unavailable',
    );
    expect(paymentErrorFor(502, 'bKash could not start the payment. Please try again.')).toBe(
      'gateway',
    );
  });

  it('falls back to the status when the message is unknown or missing', () => {
    expect(paymentErrorFor(401, null)).toBe('signedOut');
    expect(paymentErrorFor(404, 'Order was not found.')).toBe('gone');
    expect(paymentErrorFor(429, 'ThrottlerException: Too Many Requests')).toBe('tooFast');
    expect(paymentErrorFor(502, null)).toBe('gateway');
    expect(paymentErrorFor(0, null)).toBe('unavailable');
    expect(paymentErrorFor(500, null)).toBe('failed');
  });
});

describe('parsePaymentErrorKey', () => {
  it('accepts only its own keys from the address bar', () => {
    expect(parsePaymentErrorKey('gateway')).toBe('gateway');
    expect(parsePaymentErrorKey('<script>')).toBeNull();
    expect(parsePaymentErrorKey(undefined)).toBeNull();
  });
});

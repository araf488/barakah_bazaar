import { describe, expect, it } from 'vitest';

import { order } from '../../../test/checkout';
import { awaitsBkashPayment, isNavigableUrl, parsePaymentMethod } from '../rules';

describe('parsePaymentMethod', () => {
  it('reads bKash, and anything else as cash on delivery', () => {
    expect(parsePaymentMethod('BKASH')).toBe('BKASH');
    expect(parsePaymentMethod('CASH_ON_DELIVERY')).toBe('CASH_ON_DELIVERY');
    expect(parsePaymentMethod('NAGAD')).toBe('CASH_ON_DELIVERY');
    expect(parsePaymentMethod(null)).toBe('CASH_ON_DELIVERY');
  });
});

describe('awaitsBkashPayment', () => {
  it('is true for a placed, unpaid bKash order', () => {
    expect(awaitsBkashPayment(order({ paymentMethod: 'BKASH' }))).toBe(true);
  });

  it('is false once paid, confirmed, cancelled, or for cash on delivery', () => {
    expect(awaitsBkashPayment(order({ paymentMethod: 'BKASH', paymentStatus: 'PAID' }))).toBe(
      false,
    );
    expect(awaitsBkashPayment(order({ paymentMethod: 'BKASH', status: 'CONFIRMED' }))).toBe(false);
    expect(awaitsBkashPayment(order({ paymentMethod: 'BKASH', status: 'CANCELLED' }))).toBe(false);
    expect(awaitsBkashPayment(order())).toBe(false);
  });
});

describe('isNavigableUrl', () => {
  it('allows web addresses only', () => {
    expect(isNavigableUrl('https://checkout.sandbox.bka.sh/v1.2.0-beta/checkout/x')).toBe(true);
    expect(isNavigableUrl('http://127.0.0.1:3120/mock/bkash')).toBe(true);
    expect(isNavigableUrl('javascript:alert(1)')).toBe(false);
    expect(isNavigableUrl('data:text/html,hi')).toBe(false);
    expect(isNavigableUrl('/relative')).toBe(false);
  });
});

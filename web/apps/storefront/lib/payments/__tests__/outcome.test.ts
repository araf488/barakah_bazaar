import { describe, expect, it } from 'vitest';

import { parsePaymentResult } from '../outcome';

describe('parsePaymentResult', () => {
  it('reads the order number and the outcome bKash sent back', () => {
    expect(parsePaymentResult({ order: 'BB-20261125-000042', outcome: 'paid' })).toEqual({
      orderNumber: 'BB-20261125-000042',
      outcome: 'paid',
    });
  });

  it('never reads an unknown outcome as paid', () => {
    expect(parsePaymentResult({ outcome: 'PAID' }).outcome).toBe('failed');
    expect(parsePaymentResult({}).outcome).toBe('failed');
  });

  it('drops an order number that is not one of ours', () => {
    expect(parsePaymentResult({ order: '<b>x</b>', outcome: 'pending' }).orderNumber).toBeNull();
    expect(
      parsePaymentResult({ order: 'B'.repeat(41), outcome: 'pending' }).orderNumber,
    ).toBeNull();
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(parsePaymentResult({ order: ['BB-1', 'BB-2'], outcome: ['cancelled', 'paid'] })).toEqual(
      { orderNumber: 'BB-1', outcome: 'cancelled' },
    );
  });
});

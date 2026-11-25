import { describe, expect, it } from 'vitest';

import { checkoutErrorFor } from '../errors';

describe('checkoutErrorFor', () => {
  it.each([
    [409, 'Your basket is empty.', 'cartEmpty'],
    [404, 'That delivery address is no longer available.', 'addressGone'],
    [
      409,
      'Some prices have changed since you added these items. Review your basket and try again.',
      'pricesChanged',
    ],
    [409, 'Only 2 of "Ajwa Dates" left in stock. Adjust your basket and try again.', 'stock'],
    [409, 'We cannot deliver to that address right now.', 'noWarehouse'],
    [
      409,
      'We cannot deliver Fresh Milk to that address — it needs to stay cold over a shorter distance. Remove it to continue.',
      'keepCold',
    ],
    [422, 'Delivery is not available to that address yet. Please contact support.', 'noZone'],
    [409, 'That delivery slot is no longer available. Please choose another.', 'slotGone'],
    [409, 'That delivery slot is not offered for this order.', 'slotGone'],
    [400, 'Choose both a delivery slot and the date it falls on.', 'slotGone'],
    [404, 'That promo code is not valid.', 'promoInvalid'],
    [422, 'Your basket does not meet the minimum for this promo code.', 'promoMinimum'],
    [409, 'This promo code has been fully claimed.', 'promoUsedUp'],
    [409, 'You have already used this promo code.', 'promoAlreadyUsed'],
    [422, 'That promo code does not reduce this order.', 'promoNoDiscount'],
  ])('reads %i "%s" as %s', (status, message, key) => {
    expect(checkoutErrorFor(status, message)).toBe(key);
  });

  it('falls back to the status when the message is unknown or missing', () => {
    expect(checkoutErrorFor(401, 'Unauthorized')).toBe('signedOut');
    expect(checkoutErrorFor(503, null)).toBe('unavailable');
    expect(checkoutErrorFor(0, null)).toBe('unavailable');
    expect(checkoutErrorFor(500, 'Something went wrong on our end. Please try again.')).toBe(
      'failed',
    );
    expect(checkoutErrorFor(409, null)).toBe('failed');
  });
});

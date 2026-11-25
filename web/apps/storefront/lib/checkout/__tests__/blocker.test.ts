import { describe, expect, it } from 'vitest';

import { address } from '../../../test/address';
import { cartItem, serverCart } from '../../../test/cart';
import { quote, slot } from '../../../test/checkout';
import { fromServerCart } from '../../cart/view';
import { checkoutBlocker } from '../blocker';
import type { CheckoutData } from '../getCheckout';

const READY: CheckoutData = {
  cart: fromServerCart(serverCart()),
  addresses: [address()],
  selected: address(),
  quote: { ok: true, quote: quote() },
  slots: { ok: true, slots: [slot()] },
};

describe('checkoutBlocker', () => {
  it('lets a complete checkout through', () => {
    expect(checkoutBlocker(READY)).toBeNull();
  });

  it('needs an address first', () => {
    expect(checkoutBlocker({ ...READY, selected: null, quote: null, slots: null })).toBe(
      'noAddress',
    );
  });

  it('stops when the address cannot be quoted or served', () => {
    expect(checkoutBlocker({ ...READY, quote: { ok: false, error: 'noZone' } })).toBe('noZone');
    expect(checkoutBlocker({ ...READY, slots: { ok: false, error: 'keepCold' } })).toBe('keepCold');
  });

  it('stops while the cart asks for more than is in stock', () => {
    const short = fromServerCart(serverCart([cartItem({ exceedsStock: true })]));
    expect(checkoutBlocker({ ...READY, cart: short })).toBe('stock');
  });
});

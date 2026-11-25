import { describe, expect, it } from 'vitest';

import { cartItem, serverCart } from '../../../test/cart';
import { productDetail } from '../../../test/productDetail';
import { emptyCart, fromGuestLines, fromServerCart } from '../view';

describe('fromServerCart', () => {
  it('shows the API’s live prices and totals', () => {
    const view = fromServerCart(serverCart());

    expect(view).toMatchObject({
      mode: 'account',
      status: 'ok',
      itemCount: 2,
      subtotalPoysha: 250000,
    });
    expect(view.lines[0]).toMatchObject({
      key: 'item-1',
      unitPricePoysha: 125000,
      lineTotalPoysha: 250000,
      onlyLeft: null,
    });
  });

  it('flags a changed price and a line asking for more than is in stock', () => {
    const view = fromServerCart(
      serverCart([cartItem({ priceChanged: true, exceedsStock: true, availableQuantity: 1 })]),
    );

    expect(view.lines[0]).toMatchObject({ priceChanged: true, onlyLeft: 1 });
    expect(view).toMatchObject({ hasPriceChanges: true, hasStockIssues: true });
  });
});

describe('fromGuestLines', () => {
  const PRODUCTS = new Map([['ajwa-dates', productDetail()]]);

  it('prices guest lines from the live catalog', () => {
    const view = fromGuestLines([{ s: 'ajwa-dates', v: 'v-250', q: 3 }], PRODUCTS);

    expect(view).toMatchObject({ mode: 'guest', itemCount: 3, subtotalPoysha: 195000 });
    expect(view.lines[0]).toMatchObject({
      key: 'v-250',
      variantLabel: '250g',
      unitPricePoysha: 65000,
      lineTotalPoysha: 195000,
      imageUrl: 'https://cdn.example.test/ajwa-1.jpg',
    });
  });

  it('keeps a line whose product or size is gone, marked unavailable and out of the total', () => {
    const view = fromGuestLines(
      [
        { s: 'ajwa-dates', v: 'v-500', q: 1 },
        { s: 'gone', v: 'v-x', q: 2 },
      ],
      new Map([...PRODUCTS, ['gone', null]]),
    );

    expect(view.lines[1]).toMatchObject({ unavailable: true, lineTotalPoysha: null });
    expect(view.subtotalPoysha).toBe(125000);
  });
});

describe('emptyCart', () => {
  it('is zero items at zero poysha', () => {
    expect(emptyCart('guest')).toMatchObject({
      lines: [],
      itemCount: 0,
      subtotalPoysha: 0,
      status: 'ok',
    });
  });
});

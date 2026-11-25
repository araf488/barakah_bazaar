import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { order } from '../../../test/checkout';
import { renderWithIntl } from '../../../test/intl';
import { OrderCard } from '../OrderCard';

const ITEM = order().items[0]!;
const item = (n: number, quantity = 1) => ({
  ...ITEM,
  id: `oi-${n}`,
  productNameEn: `Product ${n}`,
  productNameBn: `পণ্য ${n}`,
  quantity,
});

describe('OrderCard', () => {
  it('opens the order and shows its number, status, date, item count and total', () => {
    renderWithIntl(<OrderCard order={order()} />);
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('href', '/en/account/orders/order-1');
    expect(link).toHaveTextContent('BB-20261119-0001');
    expect(link).toHaveTextContent('Placed');
    expect(link).toHaveTextContent('Placed 19 Nov 2026 · 2 items');
    expect(link).toHaveTextContent('Ajwa Dates');
    expect(link).toHaveTextContent('৳2,560.00');
  });

  it('names the first two products and counts the rest', () => {
    renderWithIntl(<OrderCard order={order({ items: [item(1), item(2), item(3), item(4)] })} />);
    expect(screen.getByRole('link')).toHaveTextContent('Product 1, Product 2 +2 more');
  });

  it('writes the card in Bangla with Bengali digits on a Bangla page', () => {
    renderWithIntl(<OrderCard order={order({ items: [item(1), item(2), item(3, 3)] })} />, 'bn');
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('পণ্য 1, পণ্য 2 আরও ১টি');
    expect(link).toHaveTextContent('৫ টি পণ্য');
    expect(link).toHaveTextContent('৳২,৫৬০.০০');
  });
});

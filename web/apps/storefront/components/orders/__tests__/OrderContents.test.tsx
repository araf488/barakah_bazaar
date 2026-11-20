import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { order } from '../../../test/checkout';
import { renderWithIntl } from '../../../test/intl';
import { OrderItems, OrderTotals } from '../OrderContents';

describe('OrderItems', () => {
  it('names each product with its quantity, size and line total', () => {
    renderWithIntl(<OrderItems items={order().items} />);
    expect(screen.getByText('Ajwa Dates')).toBeInTheDocument();
    expect(screen.getByText('2 × 500g')).toBeInTheDocument();
    expect(screen.getByText('৳2,500.00')).toBeInTheDocument();
  });

  it('names products in Bangla with Bengali digits on a Bangla page', () => {
    renderWithIntl(<OrderItems items={order().items} />, 'bn');
    expect(screen.getByText('আজওয়া খেজুর')).toBeInTheDocument();
    expect(screen.getByText('৳২,৫০০.০০')).toBeInTheDocument();
  });
});

describe('OrderTotals', () => {
  it('adds the delivery fee and leaves out a discount there was none of', () => {
    renderWithIntl(<OrderTotals order={order()} />);
    expect(screen.getByText('৳60.00')).toBeInTheDocument();
    expect(screen.getByText('৳2,560.00')).toBeInTheDocument();
    expect(screen.queryByText('Discount')).not.toBeInTheDocument();
  });

  it('shows free delivery and the discount taken off', () => {
    renderWithIntl(
      <OrderTotals
        order={order({ deliveryFeePoysha: 0, discountPoysha: 25000, totalPoysha: 225000 })}
      />,
    );
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('−৳250.00')).toBeInTheDocument();
    expect(screen.getByText('৳2,250.00')).toBeInTheDocument();
  });

  it('writes amounts in Bengali digits on a Bangla page', () => {
    renderWithIntl(<OrderTotals order={order()} />, 'bn');
    expect(screen.getByText('৳২,৫৬০.০০')).toBeInTheDocument();
  });
});

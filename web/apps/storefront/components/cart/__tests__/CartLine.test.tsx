import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { cartItem, serverCart } from '../../../test/cart';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/cart/actions', () => ({ setQuantityAction: vi.fn() }));

const { CartLine } = await import('../CartLine');
const { fromServerCart } = await import('../../../lib/cart/view');

const lineOf = (overrides = {}) => fromServerCart(serverCart([cartItem(overrides)])).lines[0]!;
const formFor = (label: string) => screen.getByRole('button', { name: label }).closest('form')!;
const valuesOf = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));

describe('CartLine', () => {
  it('names the product in the reader’s language, with size and unit price', () => {
    renderWithIntl(
      <ul>
        <CartLine line={lineOf()} />
      </ul>,
      'bn',
    );

    expect(screen.getByText('আজওয়া খেজুর')).toBeInTheDocument();
    expect(screen.getByText('500g · প্রতিটি ৳১,২৫০.০০')).toBeInTheDocument();
    expect(screen.getByText('৳২,৫০০.০০')).toBeInTheDocument();
    expect(screen.getByText('২')).toBeInTheDocument();
  });

  it('sets the quantity one lower, one higher, or to zero to remove', () => {
    renderWithIntl(
      <ul>
        <CartLine line={lineOf({ quantity: 2 })} />
      </ul>,
    );

    expect(valuesOf(formFor('One fewer Ajwa Dates'))).toEqual({ key: 'item-1', quantity: '1' });
    expect(valuesOf(formFor('One more Ajwa Dates'))).toEqual({ key: 'item-1', quantity: '3' });
    expect(valuesOf(formFor('Remove Ajwa Dates'))).toEqual({ key: 'item-1', quantity: '0' });
  });

  it('offers no "more" at the 99 cap', () => {
    renderWithIntl(
      <ul>
        <CartLine line={lineOf({ quantity: 99 })} />
      </ul>,
    );
    expect(screen.queryByRole('button', { name: 'One more Ajwa Dates' })).not.toBeInTheDocument();
  });

  it('only lets an unavailable guest line be removed', () => {
    renderWithIntl(
      <ul>
        <CartLine
          line={{ ...lineOf(), unavailable: true, unitPricePoysha: null, lineTotalPoysha: null }}
        />
      </ul>,
    );

    expect(screen.getByText('No longer available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'One more Ajwa Dates' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Ajwa Dates' })).toBeInTheDocument();
  });

  it('marks a changed price', () => {
    renderWithIntl(
      <ul>
        <CartLine line={lineOf({ priceChanged: true })} />
      </ul>,
    );
    expect(screen.getByText('Price changed since you added it')).toBeInTheDocument();
  });
});

import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { cartItem, serverCart } from '../../../test/cart';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/cart/actions', () => ({
  quickAddAction: vi.fn(),
  setQuantityAction: vi.fn(),
}));

const { QuickAdd } = await import('../QuickAdd');
const { quickAddAction } = await import('../../../lib/cart/actions');
const { fromServerCart } = await import('../../../lib/cart/view');
const { OPEN_CART_EVENT } = await import('../../../lib/cartEvents');

const linesOf = (...items: Parameters<typeof cartItem>[0][]) =>
  fromServerCart(serverCart(items.map((i) => cartItem(i)))).lines;
const valuesOf = (label: string) =>
  Object.fromEntries(new FormData(screen.getByRole('button', { name: label }).closest('form')!));

describe('QuickAdd', () => {
  it('offers a "+" that names the product, until it is in the cart', () => {
    renderWithIntl(<QuickAdd slug="ajwa-dates" name="Ajwa Dates" lines={[]} />);
    expect(valuesOf('Add Ajwa Dates to cart')).toEqual({ slug: 'ajwa-dates' });
  });

  it('turns into a stepper for the one line in the cart', () => {
    renderWithIntl(
      <QuickAdd slug="ajwa-dates" name="Ajwa Dates" lines={linesOf({ quantity: 2 })} />,
    );

    expect(
      screen.queryByRole('button', { name: 'Add Ajwa Dates to cart' }),
    ).not.toBeInTheDocument();
    expect(valuesOf('One fewer Ajwa Dates')).toEqual({ key: 'item-1', quantity: '1' });
    expect(valuesOf('One more Ajwa Dates')).toEqual({ key: 'item-1', quantity: '3' });
  });

  it('writes the count in Bengali digits on a Bangla page', () => {
    renderWithIntl(
      <QuickAdd slug="ajwa-dates" name="আজওয়া খেজুর" lines={linesOf({ quantity: 3 })} />,
      'bn',
    );
    expect(screen.getByText('৩')).toBeInTheDocument();
  });

  it('shows the total and opens the cart when several sizes are in it', () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_CART_EVENT, listener);
    renderWithIntl(
      <QuickAdd
        slug="ajwa-dates"
        name="Ajwa Dates"
        lines={linesOf({ id: 'a', quantity: 2 }, { id: 'b', variantId: 'v-250', quantity: 1 })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '3 in cart' }));

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_CART_EVENT, listener);
  });

  it('explains a refusal next to the button', async () => {
    vi.mocked(quickAddAction).mockResolvedValue({ status: 'error', error: 'stock' });
    renderWithIntl(<QuickAdd slug="doi" name="Doi" lines={[]} />);

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Add Doi to cart' }).closest('form')!);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'There is not enough stock for that quantity.',
    );
  });
});

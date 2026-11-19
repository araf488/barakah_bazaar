import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cartItem, serverCart } from '../../../test/cart';
import { renderWithIntl } from '../../../test/intl';
import { navigationState } from '../../../test/navigation';

vi.mock('../../../lib/cart/actions', () => ({ setQuantityAction: vi.fn() }));

const { CartDrawer } = await import('../CartDrawer');
const { openCart } = await import('../../../lib/cartEvents');
const { emptyCart, fromServerCart } = await import('../../../lib/cart/view');

const dialog = () => screen.getByRole('dialog', { hidden: true });
const openViaPill = () => fireEvent.click(screen.getByRole('button', { name: /Open cart/ }));
const GUEST_WITH_LINE = { ...fromServerCart(serverCart()), mode: 'guest' as const };

describe('CartDrawer', () => {
  afterEach(() => {
    navigationState.pathname = '/en';
  });

  it('shows the item count on the pill and says it in full', () => {
    renderWithIntl(<CartDrawer cart={fromServerCart(serverCart())} />);
    expect(screen.getByRole('button', { name: 'Open cart, 2 items' })).toHaveTextContent('2');
  });

  it('opens from the pill and from anywhere else on the page', () => {
    renderWithIntl(<CartDrawer cart={emptyCart('guest')} />);

    openViaPill();
    expect(dialog()).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Close cart', hidden: true }));
    expect(dialog()).not.toHaveAttribute('open');

    act(() => openCart());
    expect(dialog()).toHaveAttribute('open');
  });

  it('says so when the cart is empty, with a way to start shopping', () => {
    renderWithIntl(<CartDrawer cart={emptyCart('guest')} />);
    openViaPill();

    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse new arrivals', hidden: true })).toHaveAttribute(
      'href',
      '/en#new-arrivals',
    );
  });

  it('says so when the account cart could not load', () => {
    renderWithIntl(<CartDrawer cart={emptyCart('account', 'error')} />);
    openViaPill();
    expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
      'Your cart could not be loaded',
    );
  });

  it('lists the lines with the subtotal, leaving delivery to checkout', () => {
    renderWithIntl(<CartDrawer cart={fromServerCart(serverCart())} />);
    openViaPill();
    const drawer = within(dialog());

    expect(drawer.getByText('Ajwa Dates')).toBeInTheDocument();
    expect(drawer.getByText('৳2,500.00', { selector: 'dd' })).toBeInTheDocument();
    expect(drawer.getByText('Calculated at checkout')).toBeInTheDocument();
    expect(drawer.queryByText(/৳80|free delivery/i)).not.toBeInTheDocument();
  });

  it('asks a guest to sign in to check out, returning to this page', () => {
    navigationState.pathname = '/en/p/ajwa-dates';
    renderWithIntl(<CartDrawer cart={GUEST_WITH_LINE} />);
    openViaPill();

    expect(
      screen.getByRole('link', { name: 'Sign in to check out', hidden: true }),
    ).toHaveAttribute('href', '/en/sign-in?next=%2Fp%2Fajwa-dates');
    expect(
      screen.getByText('Your cart moves to your account when you sign in.'),
    ).toBeInTheDocument();
  });

  it('tells a signed-in customer checkout is next, without a dead button', () => {
    renderWithIntl(<CartDrawer cart={fromServerCart(serverCart())} />);
    openViaPill();

    expect(screen.getByText('Checkout opens with the next update.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /checkout/i, hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('warns about changed prices and short stock', () => {
    renderWithIntl(
      <CartDrawer
        cart={fromServerCart(
          serverCart([cartItem({ priceChanged: true, exceedsStock: true, availableQuantity: 1 })]),
        )}
      />,
    );
    openViaPill();

    expect(screen.getByText(/Some prices changed since you added them/)).toBeInTheDocument();
    expect(screen.getByText(/Some items have less stock/)).toBeInTheDocument();
    expect(screen.getByText('Only 1 left')).toBeInTheDocument();
  });
});

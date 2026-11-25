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

  it('asks a guest to sign in to check out, returning to checkout', () => {
    navigationState.pathname = '/en/p/ajwa-dates';
    renderWithIntl(<CartDrawer cart={GUEST_WITH_LINE} />);
    openViaPill();

    expect(
      screen.getByRole('link', { name: 'Sign in to check out', hidden: true }),
    ).toHaveAttribute('href', '/en/sign-in?next=%2Fcheckout');
    expect(
      screen.getByText('Your cart moves to your account when you sign in.'),
    ).toBeInTheDocument();
  });

  it('sends a signed-in customer to checkout', () => {
    renderWithIntl(<CartDrawer cart={fromServerCart(serverCart())} />);
    openViaPill();

    expect(screen.getByRole('link', { name: 'Check out', hidden: true })).toHaveAttribute(
      'href',
      '/en/checkout',
    );
  });

  it('shows the default address fee and how much more makes delivery free', () => {
    renderWithIntl(
      <CartDrawer
        cart={fromServerCart(serverCart())}
        delivery={{ place: 'Banani', feePoysha: 6000, isFree: false, shortfallPoysha: 50000 }}
      />,
    );
    openViaPill();
    const drawer = within(dialog());

    expect(drawer.getByText('৳60.00', { selector: 'dd' })).toBeInTheDocument();
    expect(drawer.getByText('Add ৳500.00 more for free delivery to Banani.')).toBeInTheDocument();
  });

  it('says delivery is free once the cart qualifies', () => {
    renderWithIntl(
      <CartDrawer
        cart={fromServerCart(serverCart())}
        delivery={{ place: 'Banani', feePoysha: 0, isFree: true, shortfallPoysha: 0 }}
      />,
    );
    openViaPill();
    const drawer = within(dialog());

    expect(drawer.getByText('Free', { selector: 'dd' })).toBeInTheDocument();
    expect(drawer.getByText('Free delivery to Banani.')).toBeInTheDocument();
  });

  it('leaves delivery to checkout when the quote failed', () => {
    renderWithIntl(
      <CartDrawer
        cart={fromServerCart(serverCart())}
        delivery={{ place: 'Banani', feePoysha: null, isFree: false, shortfallPoysha: 0 }}
      />,
    );
    openViaPill();

    expect(within(dialog()).getByText('Calculated at checkout')).toBeInTheDocument();
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

  it('writes the count and subtotal in Bengali digits on a Bangla page', () => {
    renderWithIntl(<CartDrawer cart={fromServerCart(serverCart())} />, 'bn');
    const pill = screen.getByRole('button', { name: 'কার্ট খুলুন, ২টি পণ্য' });
    fireEvent.click(pill);

    expect(pill).toHaveTextContent('২');
    expect(screen.getByText('৳২,৫০০.০০', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('(২টি পণ্য)')).toBeInTheDocument();
  });
});

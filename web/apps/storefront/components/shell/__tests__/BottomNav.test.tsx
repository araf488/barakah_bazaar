import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { navigationState } from '../../../test/navigation';

vi.mock('../../../lib/auth/actions', () => ({ signOutAction: vi.fn() }));

const { BottomNav } = await import('../BottomNav');
const { OPEN_CART_EVENT } = await import('../../../lib/cartEvents');
const { OPEN_SEARCH_EVENT } = await import('../../../lib/searchEvents');

const nav = () => within(screen.getByRole('navigation', { name: 'Main menu' }));

describe('BottomNav', () => {
  afterEach(() => {
    navigationState.pathname = '/en';
  });

  it('offers Home, Search, Cart and Sign in to a guest', () => {
    renderWithIntl(<BottomNav cartCount={0} signedIn={false} />);

    expect(nav().getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/en');
    expect(nav().getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(nav().getByRole('button', { name: 'Open cart, empty' })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/en/sign-in');
  });

  it('marks Home as the current page on the home page', () => {
    navigationState.pathname = '/en';
    renderWithIntl(<BottomNav cartCount={0} signedIn={false} />);
    expect(nav().getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the search and the cart', () => {
    const search = vi.fn();
    const cart = vi.fn();
    window.addEventListener(OPEN_SEARCH_EVENT, search);
    window.addEventListener(OPEN_CART_EVENT, cart);
    renderWithIntl(<BottomNav cartCount={3} signedIn={false} />);

    fireEvent.click(nav().getByRole('button', { name: 'Search' }));
    fireEvent.click(nav().getByRole('button', { name: 'Open cart, 3 items' }));

    expect(search).toHaveBeenCalledTimes(1);
    expect(cart).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_SEARCH_EVENT, search);
    window.removeEventListener(OPEN_CART_EVENT, cart);
  });

  it('shows the cart count in Bengali digits on a Bangla page', () => {
    navigationState.pathname = '/bn';
    renderWithIntl(<BottomNav cartCount={12} signedIn={false} />, 'bn');
    expect(screen.getByText('১২')).toBeInTheDocument();
  });

  it('offers sign-out once signed in', () => {
    renderWithIntl(<BottomNav cartCount={0} signedIn />);
    expect(nav().getByRole('button', { name: 'Sign out' }).closest('form')).not.toBeNull();
    expect(nav().queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});

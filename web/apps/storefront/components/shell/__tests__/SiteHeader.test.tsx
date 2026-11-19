import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { category } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { emptyCart } from '../../../lib/cart/view';
import { SiteHeader } from '../SiteHeader';

const GUEST_CART = emptyCart('guest');

describe('SiteHeader', () => {
  afterEach(() => restoreLivePages());

  it('links the logo home under the current locale', () => {
    renderWithIntl(<SiteHeader categories={[]} user={null} cart={GUEST_CART} />);
    expect(screen.getByRole('link', { name: 'Barakah Bazaar home' })).toHaveAttribute(
      'href',
      '/en',
    );
  });

  it('offers sign-in, registration and the cart drawer while signed out', () => {
    setLivePages('all');
    renderWithIntl(<SiteHeader categories={[]} user={null} cart={GUEST_CART} />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/en/sign-in');
    expect(screen.getByRole('link', { name: 'Join free' })).toHaveAttribute('href', '/en/register');
    expect(screen.getByRole('button', { name: 'Open cart, empty' })).toBeInTheDocument();
  });

  it('carries the search trigger, the language switch and the category row', () => {
    setLivePages('all');
    renderWithIntl(<SiteHeader categories={[category()]} user={null} cart={GUEST_CART} />);

    expect(
      screen.getByRole('button', { name: /Search dates, doi, fresh fruit/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Switch to Bangla' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dates' })).toHaveAttribute('href', '/en/c/dates');
  });

  it('links to no page that does not exist yet', () => {
    setLivePages([]);
    renderWithIntl(<SiteHeader categories={[category()]} user={null} cart={GUEST_CART} />);

    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/en', '/bn']);
  });

  it('has no admin-portal or flash-deal entry, which the storefront does not serve', () => {
    setLivePages('all');
    renderWithIntl(<SiteHeader categories={[]} user={null} cart={GUEST_CART} />);

    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/flash/i)).not.toBeInTheDocument();
  });

  it('greets a signed-in customer by first name and offers to sign out', () => {
    setLivePages('all');
    renderWithIntl(
      <SiteHeader
        categories={[]}
        user={{
          id: 'u1',
          email: 'tahmina@example.test',
          fullName: 'Tahmina Rahman',
          phoneVerified: false,
          role: 'CUSTOMER',
          createdAt: '2026-11-01',
        }}
        cart={GUEST_CART}
      />,
    );

    expect(screen.getByRole('link', { name: 'Hi, Tahmina' })).toHaveAttribute(
      'href',
      '/en/account',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('falls back to the email name when no full name was given', () => {
    renderWithIntl(
      <SiteHeader
        categories={[]}
        user={{
          id: 'u1',
          email: 'karim@example.test',
          fullName: null,
          phoneVerified: false,
          role: 'CUSTOMER',
          createdAt: '2026-11-01',
        }}
        cart={GUEST_CART}
      />,
    );
    expect(screen.getByText('Hi, karim')).toBeInTheDocument();
  });
});

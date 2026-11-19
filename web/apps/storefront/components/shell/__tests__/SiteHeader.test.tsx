import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { category } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { SiteHeader } from '../SiteHeader';

describe('SiteHeader', () => {
  afterEach(() => restoreLivePages());

  it('links the logo home under the current locale', () => {
    renderWithIntl(<SiteHeader categories={[]} />);
    expect(screen.getByRole('link', { name: 'Barakah Bazaar home' })).toHaveAttribute(
      'href',
      '/en',
    );
  });

  it('offers sign-in, registration and the cart while signed out', () => {
    setLivePages('all');
    renderWithIntl(<SiteHeader categories={[]} />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/en/sign-in');
    expect(screen.getByRole('link', { name: 'Join free' })).toHaveAttribute('href', '/en/register');
    expect(screen.getByRole('link', { name: 'Cart' })).toHaveAttribute('href', '/en/cart');
  });

  it('carries the search trigger, the language switch and the category row', () => {
    setLivePages('all');
    renderWithIntl(<SiteHeader categories={[category()]} />);

    expect(screen.getByRole('button', { name: 'Search products' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Switch to Bangla' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dates' })).toHaveAttribute('href', '/en/c/dates');
  });

  it('links to no page that does not exist yet', () => {
    setLivePages([]);
    renderWithIntl(<SiteHeader categories={[category()]} />);

    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/en', '/bn']);
  });

  it('has no admin-portal or flash-deal entry, which the storefront does not serve', () => {
    setLivePages('all');
    renderWithIntl(<SiteHeader categories={[]} />);

    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/flash/i)).not.toBeInTheDocument();
  });
});

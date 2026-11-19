import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { category } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { SiteFooter } from '../SiteFooter';

const SEVEN_CATEGORIES = Array.from({ length: 7 }, (_, i) =>
  category({ id: `c${i}`, slug: `cat-${i}`, nameEn: `Category ${i}`, sortOrder: i }),
);

const column = (heading: string) =>
  screen.getByRole('heading', { name: heading }).parentElement as HTMLElement;

describe('SiteFooter', () => {
  beforeEach(() => setLivePages('all'));
  afterEach(() => restoreLivePages());

  it('lists the first six categories under Shop', () => {
    renderWithIntl(<SiteFooter categories={SEVEN_CATEGORIES} />);

    const links = within(column('Shop')).getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(links[0]).toHaveAttribute('href', '/en/c/cat-0');
    expect(screen.queryByRole('link', { name: 'Category 6' })).not.toBeInTheDocument();
  });

  it('offers only help pages the storefront has', () => {
    renderWithIntl(<SiteFooter categories={[]} />);

    expect(
      within(column('Help'))
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Track your order', '/en/account/orders'],
      ['My account', '/en/account'],
    ]);
  });

  it('accepts only the payment methods the API supports', () => {
    renderWithIntl(<SiteFooter categories={[]} />);

    expect(
      within(column('We accept'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Cash on delivery', 'bKash']);
    expect(screen.queryByText(/Nagad|Rocket|SSLCommerz|Pathao|RedX|Steadfast/)).toBeNull();
  });

  it('leaves out the Shop and Help columns while their pages do not exist', () => {
    setLivePages([]);
    renderWithIntl(<SiteFooter categories={SEVEN_CATEGORIES} />);

    expect(screen.queryByRole('heading', { name: 'Shop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/en']);
    expect(screen.getByRole('heading', { name: 'We accept' })).toBeInTheDocument();
  });

  it('shows only the help links whose pages exist', () => {
    setLivePages(['orders']);
    renderWithIntl(<SiteFooter categories={[]} />);

    expect(
      within(column('Help'))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Track your order']);
  });

  it('dates the copyright to the current year, in Bangla on a Bangla page', () => {
    renderWithIntl(<SiteFooter categories={[]} />, 'bn');

    expect(
      screen.getByText(`© ${new Date().getFullYear()} বারাকাহ বাজার। সর্বস্বত্ব সংরক্ষিত।`),
    ).toBeInTheDocument();
  });
});

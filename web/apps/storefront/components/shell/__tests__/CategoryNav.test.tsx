import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { category } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { navigationState } from '../../../test/navigation';
import { CategoryNav } from '../CategoryNav';

const CATEGORIES = [
  category(),
  category({ id: 'c-doi', slug: 'doi', nameEn: 'Doi', nameBn: 'দই', sortOrder: 2 }),
];

describe('CategoryNav', () => {
  beforeEach(() => setLivePages('all'));
  afterEach(() => {
    navigationState.pathname = '/en';
    restoreLivePages();
  });

  it('lists Home, the categories in the order given, then Fresh daily', () => {
    renderWithIntl(<CategoryNav categories={CATEGORIES} />);
    const nav = screen.getByRole('navigation', { name: 'Shop by category' });

    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Home', '/en'],
      ['Dates', '/en/c/dates'],
      ['Doi', '/en/c/doi'],
      ['Fresh daily', '/en/fresh'],
    ]);
  });

  it('names categories in Bangla on a Bangla page', () => {
    navigationState.pathname = '/bn';
    renderWithIntl(<CategoryNav categories={CATEGORIES} />, 'bn');

    expect(screen.getByRole('link', { name: 'খেজুর' })).toHaveAttribute('href', '/bn/c/dates');
  });

  it('falls back to the English name when the Bangla one is blank', () => {
    navigationState.pathname = '/bn';
    renderWithIntl(<CategoryNav categories={[category({ nameBn: ' ' })]} />, 'bn');

    expect(screen.getByRole('link', { name: 'Dates' })).toBeInTheDocument();
  });

  it('marks the page the visitor is on', () => {
    navigationState.pathname = '/en/c/doi';
    renderWithIntl(<CategoryNav categories={CATEGORIES} />);

    expect(screen.getByRole('link', { name: 'Doi' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('still offers Home and Fresh daily when the categories could not be loaded', () => {
    renderWithIntl(<CategoryNav categories={[]} />);

    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Fresh daily']);
  });

  it('links no category until category pages exist', () => {
    setLivePages(['fresh']);
    renderWithIntl(<CategoryNav categories={CATEGORIES} />);

    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Fresh daily']);
  });

  it('renders no category row while it would hold nothing but Home', () => {
    setLivePages([]);
    renderWithIntl(<CategoryNav categories={CATEGORIES} />);

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

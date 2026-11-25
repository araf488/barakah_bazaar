import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { category, product } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { Breadcrumb } from '../Breadcrumb';

describe('Breadcrumb', () => {
  afterEach(() => restoreLivePages());

  const crumbs = () => within(screen.getByRole('navigation', { name: 'You are here' }));

  it('leads from home through the category to the product', () => {
    renderWithIntl(<Breadcrumb category={category()} product={product()} />);

    expect(crumbs().getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/en');
    expect(crumbs().getByRole('link', { name: 'Dates' })).toHaveAttribute(
      'href',
      '/en?category=dates#new-arrivals',
    );
    expect(crumbs().getByText('Ajwa Dates').closest('li')).toHaveAttribute('aria-current', 'page');
  });

  it('links the category page once it exists', () => {
    setLivePages(['category']);
    renderWithIntl(<Breadcrumb category={category()} product={product()} />);

    expect(crumbs().getByRole('link', { name: 'Dates' })).toHaveAttribute('href', '/en/c/dates');
  });

  it('skips the category when it is not in the tree', () => {
    renderWithIntl(<Breadcrumb category={undefined} product={product()} />);
    expect(crumbs().getAllByRole('link')).toHaveLength(1);
  });
});

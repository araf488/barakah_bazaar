import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { category } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../ProductGrid', () => ({
  ProductGrid: ({ filter }: { filter: { kind: string } }) => <p>grid:{filter.kind}</p>,
  ProductGridSkeleton: () => <p>loading</p>,
}));

const { NewArrivals } = await import('../NewArrivals');

const CATEGORIES = [
  category(),
  category({ id: 'c-doi', slug: 'doi', nameEn: 'Doi', nameBn: 'দই' }),
];

const chips = () => within(screen.getByRole('navigation', { name: 'Filter new arrivals' }));

describe('NewArrivals', () => {
  it('is titled for what it is, not "featured"', () => {
    renderWithIntl(<NewArrivals filter={{ kind: 'all' }} categories={[]} />);

    expect(screen.getByRole('heading', { name: 'New arrivals' })).toBeInTheDocument();
    expect(screen.queryByText(/featured|handpicked/i)).not.toBeInTheDocument();
  });

  it('offers All, Fresh daily, then each category, as links that keep the page in place', () => {
    renderWithIntl(<NewArrivals filter={{ kind: 'all' }} categories={CATEGORIES} />);

    expect(
      chips()
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['All', '/en#new-arrivals'],
      ['Fresh daily', '/en?fresh=1#new-arrivals'],
      ['Dates', '/en?category=dates#new-arrivals'],
      ['Doi', '/en?category=doi#new-arrivals'],
    ]);
  });

  it('marks the chip that is applied', () => {
    renderWithIntl(
      <NewArrivals filter={{ kind: 'category', slug: 'doi' }} categories={CATEGORIES} />,
    );

    expect(chips().getByRole('link', { name: 'Doi' })).toHaveAttribute('aria-current', 'true');
    expect(chips().getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
  });

  it('hands the applied filter to the grid', async () => {
    renderWithIntl(<NewArrivals filter={{ kind: 'fresh' }} categories={[]} />);
    expect(await screen.findByText('grid:fresh')).toBeInTheDocument();
  });

  it('is the target the category links scroll to', () => {
    const { container } = renderWithIntl(<NewArrivals filter={{ kind: 'all' }} categories={[]} />);
    expect(container.querySelector('section')).toHaveAttribute('id', 'new-arrivals');
  });
});

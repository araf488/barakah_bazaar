import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { page, product } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/api/catalog', () => ({ listNewestProducts: vi.fn() }));

const { ProductGrid, ProductGridResult, ProductGridSkeleton } = await import('../ProductGrid');
const { listNewestProducts } = await import('../../../lib/api/catalog');

describe('ProductGrid', () => {
  it('asks for the filtered products and renders what comes back', async () => {
    const result = { ok: true as const, page: page([product()]) };
    vi.mocked(listNewestProducts).mockResolvedValue(result);

    const element = (await ProductGrid({ filter: { kind: 'fresh' } })) as ReactElement<{
      result: unknown;
    }>;

    expect(listNewestProducts).toHaveBeenCalledWith({ limit: 8, perishableOnly: true });
    expect(element.props.result).toBe(result);
  });
});

describe('ProductGridResult', () => {
  it('lists one card per product', () => {
    renderWithIntl(
      <ProductGridResult
        result={{
          ok: true,
          page: page([product(), product({ id: 'p2', nameEn: 'Medjool Dates' })]),
        }}
        filter={{ kind: 'all' }}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('says so when products could not be loaded', () => {
    renderWithIntl(<ProductGridResult result={{ ok: false }} filter={{ kind: 'all' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Products could not be loaded right now. Please refresh the page in a moment.',
    );
  });

  it('offers the way back to everything when a filter matches nothing', () => {
    renderWithIntl(
      <ProductGridResult
        result={{ ok: true, page: page([]) }}
        filter={{ kind: 'category', slug: 'doi' }}
      />,
    );

    expect(screen.getByText('Nothing in this category yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all new arrivals' })).toHaveAttribute(
      'href',
      '/en#new-arrivals',
    );
  });

  it('has no way back to offer when nothing is listed at all', () => {
    renderWithIntl(
      <ProductGridResult result={{ ok: true, page: page([]) }} filter={{ kind: 'all' }} />,
    );

    expect(
      screen.getByText('No products are listed yet. Please check back soon.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('ProductGridSkeleton', () => {
  it('announces loading and hides its placeholder cards from assistive tech', () => {
    const { container } = renderWithIntl(<ProductGridSkeleton />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading products…');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { product } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { ProductCard } from '../ProductCard';

describe('ProductCard', () => {
  afterEach(() => restoreLivePages());

  it('shows the name in the reader’s language and the cheapest price', () => {
    renderWithIntl(<ProductCard product={product()} />, 'bn');

    expect(screen.getByRole('heading', { name: 'আজওয়া খেজুর' })).toBeInTheDocument();
    expect(screen.getByText('৳1,250.00 থেকে')).toBeInTheDocument();
  });

  it('links to the product page once it exists', () => {
    setLivePages(['product']);
    renderWithIntl(<ProductCard product={product()} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/p/ajwa-dates');
  });

  it('is not a link while product pages do not exist', () => {
    setLivePages([]);
    renderWithIntl(<ProductCard product={product()} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['CHILLED', 'Chilled'],
    ['FROZEN', 'Frozen'],
    ['AMBIENT', 'Perishable'],
  ] as const)('badges a perishable stored %s as “%s”', (storageType, label) => {
    renderWithIntl(
      <ProductCard product={product({ handling: { isPerishable: true, storageType } })} />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('carries no badge for a shelf-stable product', () => {
    renderWithIntl(<ProductCard product={product()} />);

    expect(screen.queryByText(/Chilled|Frozen|Perishable/)).not.toBeInTheDocument();
  });

  it('shows no stars until the product has been rated', () => {
    renderWithIntl(<ProductCard product={product({ rating: { average: null, count: 0 } })} />);

    expect(screen.queryByText(/Rated/)).not.toBeInTheDocument();
  });

  it('shows the average and review count once rated, read out in full', () => {
    renderWithIntl(<ProductCard product={product({ rating: { average: 4.5, count: 12 } })} />);

    expect(screen.getByText('4.5 (12)')).toBeInTheDocument();
    expect(screen.getByText('Rated 4.5 out of 5 from 12 reviews')).toBeInTheDocument();
  });

  it('reserves the image’s space and keeps it out of the accessible name', () => {
    const { container } = renderWithIntl(<ProductCard product={product()} />);
    const img = container.querySelector('img');

    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width', '400');
    expect(img).toHaveAttribute('height', '400');
  });
});

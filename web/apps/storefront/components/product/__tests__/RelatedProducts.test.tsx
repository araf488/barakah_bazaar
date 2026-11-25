import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { category, page, product } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/api/catalog', () => ({ listNewestProducts: vi.fn() }));
vi.mock('../../../lib/cart/getCart', () => ({
  getCart: vi.fn(async () => ({
    mode: 'guest',
    status: 'ok',
    lines: [],
    itemCount: 0,
    subtotalPoysha: 0,
    hasPriceChanges: false,
    hasStockIssues: false,
  })),
}));
vi.mock('../../../lib/cart/actions', () => ({
  quickAddAction: vi.fn(),
  setQuantityAction: vi.fn(),
}));

const { RelatedList, RelatedProducts } = await import('../RelatedProducts');
const { listNewestProducts } = await import('../../../lib/api/catalog');

const items = (slugs: string[]) => slugs.map((slug) => product({ id: slug, slug, nameEn: slug }));

describe('RelatedProducts', () => {
  const load = async (result: Awaited<ReturnType<typeof listNewestProducts>>) => {
    vi.mocked(listNewestProducts).mockResolvedValue(result);
    return (await RelatedProducts({
      slug: 'ajwa',
      categorySlug: 'dates',
      category: undefined,
    })) as ReactElement<{
      items: Array<{ slug: string }>;
    }>;
  };

  it('asks for five from the same category so four remain without this product', async () => {
    await load({ ok: true, page: page([]) });
    expect(listNewestProducts).toHaveBeenCalledWith({ categorySlug: 'dates', limit: 5 });
  });

  it('drops the product being viewed and keeps four', async () => {
    const element = await load({ ok: true, page: page(items(['a', 'ajwa', 'b', 'c', 'd'])) });
    expect(element.props.items.map((i) => i.slug)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('suggests nothing, rather than an error, when the list fails', async () => {
    const element = await load({ ok: false });
    expect(element.props.items).toEqual([]);
  });
});

describe('RelatedList', () => {
  it('names the category it draws from', () => {
    renderWithIntl(<RelatedList items={items(['a'])} category={category()} />, 'bn');
    expect(screen.getByRole('heading', { name: 'খেজুর থেকে আরও' })).toBeInTheDocument();
  });

  it('uses a general title when the category is unknown', () => {
    renderWithIntl(<RelatedList items={items(['a'])} category={undefined} />);
    expect(screen.getByRole('heading', { name: 'You might also like' })).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to suggest', () => {
    const { container } = renderWithIntl(<RelatedList items={[]} category={category()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

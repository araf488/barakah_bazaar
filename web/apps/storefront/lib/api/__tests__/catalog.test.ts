import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { category, jsonResponse, page, product } from '../../../test/fixtures';
import { fetchTopCategories, listNewestProducts, searchProducts } from '../catalog';

describe('fetchTopCategories', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads the category tree from the internal API, cached for five minutes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchTopCategories();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.internal/api/v1/catalog/categories',
      expect.objectContaining({ next: { revalidate: 300 } }),
    );
  });

  it('orders the categories by the admin’s sort order', async () => {
    const tree = [
      category({ id: 'b', sortOrder: 2 }),
      category({ id: 'c', sortOrder: 3 }),
      category({ id: 'a', sortOrder: 1 }),
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(tree)));

    const ids = (await fetchTopCategories()).map((c) => c.id);

    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('renders no categories, rather than an error page, when the API answers 5xx', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    await expect(fetchTopCategories()).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('renders no categories when the API cannot be reached at all', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(fetchTopCategories()).resolves.toEqual([]);
  });
});

describe('searchProducts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('asks the same-origin API for eight relevance-ranked matches', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', undefined);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([product()])));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchProducts('ajwa dates');

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string, 'http://storefront.test');
    expect(url.pathname).toBe('/api/v1/catalog/products');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'ajwa dates',
      sort: 'relevance',
      limit: '8',
    });
    expect(result.items[0]?.slug).toBe('ajwa-dates');
  });

  it('passes the abort signal through, so a newer query can cancel this one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([])));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await searchProducts('doi', controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
});

describe('listNewestProducts', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const requested = (fetchMock: ReturnType<typeof vi.fn>) =>
    new URL(fetchMock.mock.calls[0]?.[0] as string);

  it('asks the internal API for the newest products, cached for a minute', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([product()])));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listNewestProducts({ limit: 8 });

    const url = requested(fetchMock);
    expect(url.origin + url.pathname).toBe('http://api.internal/api/v1/catalog/products');
    expect(Object.fromEntries(url.searchParams)).toEqual({ sort: 'newest', limit: '8' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ next: { revalidate: 60 } });
    expect(result).toEqual({ ok: true, page: page([product()]) });
  });

  it('passes the category and perishables filters through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([])));
    vi.stubGlobal('fetch', fetchMock);

    await listNewestProducts({ limit: 8, categorySlug: 'doi', perishableOnly: true });

    expect(Object.fromEntries(requested(fetchMock).searchParams)).toEqual({
      sort: 'newest',
      limit: '8',
      categorySlug: 'doi',
      perishableOnly: 'true',
    });
  });

  it('reports failure as a value, so the page shows its error state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    await expect(listNewestProducts({ limit: 8 })).resolves.toEqual({ ok: false });
    expect(console.error).toHaveBeenCalled();
  });
});

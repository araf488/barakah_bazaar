import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { category, jsonResponse, page, product } from '../../../test/fixtures';
import { productDetail } from '../../../test/productDetail';
import {
  fetchTopCategories,
  findCategoryBySlug,
  getProductBySlug,
  listNewestProducts,
  searchProducts,
} from '../catalog';

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

describe('getProductBySlug', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads the product by slug from the internal API, cached for a minute', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(productDetail()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductBySlug('ajwa-dates');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://api.internal/api/v1/catalog/products/ajwa-dates',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ next: { revalidate: 60 } });
    expect(result).toEqual({ ok: true, product: productDetail() });
  });

  it('escapes the slug into one path segment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(productDetail()));
    vi.stubGlobal('fetch', fetchMock);

    await getProductBySlug('doi/../admin');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://api.internal/api/v1/catalog/products/doi%2F..%2Fadmin',
    );
  });

  it('reports an unknown or unpublished product as not found, without logging an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));

    await expect(getProductBySlug('gone')).resolves.toEqual({ ok: false, notFound: true });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('reports any other failure as an error, and logs it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));

    await expect(getProductBySlug('ajwa')).resolves.toEqual({ ok: false, notFound: false });
    expect(console.error).toHaveBeenCalled();
  });
});

describe('findCategoryBySlug', () => {
  const tree = [
    category({ id: 'a', slug: 'fresh', children: [category({ id: 'b', slug: 'doi' })] }),
    category({ id: 'c', slug: 'dates' }),
  ];

  it('finds a top-level category', () => {
    expect(findCategoryBySlug(tree, 'dates')?.id).toBe('c');
  });

  it('finds a sub-category', () => {
    expect(findCategoryBySlug(tree, 'doi')?.id).toBe('b');
  });

  it('finds nothing for an unknown slug', () => {
    expect(findCategoryBySlug(tree, 'nope')).toBeUndefined();
  });
});

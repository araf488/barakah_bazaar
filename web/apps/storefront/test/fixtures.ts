import type { CategoryNode, Paginated, ProductListItem } from '../lib/api/catalog';

export const category = (overrides: Partial<CategoryNode> = {}): CategoryNode => ({
  id: 'c-dates',
  slug: 'dates',
  nameEn: 'Dates',
  nameBn: 'খেজুর',
  imageUrl: null,
  sortOrder: 1,
  children: [],
  ...overrides,
});

export const product = (overrides: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p-ajwa',
  slug: 'ajwa-dates',
  nameEn: 'Ajwa Dates',
  nameBn: 'আজওয়া খেজুর',
  brand: null,
  pricingMode: 'UNIT',
  fromPricePoysha: 125000,
  fromPriceFormatted: '৳1,250.00',
  primaryImage: { url: 'https://cdn.example.test/ajwa.jpg', altText: null, isPrimary: true },
  handling: { isPerishable: false, storageType: 'AMBIENT' },
  rating: { average: null, count: 0 },
  ...overrides,
});

export const page = <T>(items: T[]): Paginated<T> => ({
  items,
  meta: { page: 1, limit: 8, totalItems: items.length, totalPages: 1, hasNextPage: false },
});

/** A `fetch` answer with a JSON body. */
export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

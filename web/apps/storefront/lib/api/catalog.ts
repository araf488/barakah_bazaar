import { browserApiBaseUrl, serverApiBaseUrl } from './config';
import { getJson } from './http';

// Hand-written mirrors of src/modules/catalog/dto/catalog-response.dto.ts until the generated
// client exists (web/README.md, packages/api-client). Field names match the API exactly.

export interface CategoryNode {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  imageUrl?: string | null;
  sortOrder: number;
  children: CategoryNode[];
}

export interface ProductImage {
  url: string;
  altText?: string | null;
  isPrimary: boolean;
}

export interface ProductHandling {
  isPerishable: boolean;
  storageType: 'AMBIENT' | 'CHILLED' | 'FROZEN';
  shelfLifeHours?: number | null;
  maxDeliveryDistanceKm?: number | null;
}

export interface ProductListItem {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  brand?: string | null;
  pricingMode: 'UNIT' | 'WEIGHT';
  /** The cheapest variant, in integer poysha. */
  fromPricePoysha: number;
  /** Display text for {@link fromPricePoysha}, e.g. `৳1,250.00`. */
  fromPriceFormatted: string;
  primaryImage?: ProductImage | null;
  handling: ProductHandling;
  rating: { average: number | null; count: number };
}

export interface Paginated<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

/** Categories change rarely; the shell re-reads them at most every five minutes. */
export const CATEGORY_TREE_REVALIDATE_SECONDS = 300;

/** How many matches the search overlay shows; the full list belongs to the search page. */
export const SEARCH_RESULT_LIMIT = 8;

const CATEGORIES_PATH = '/catalog/categories';
const PRODUCTS_PATH = '/catalog/products';
const RELEVANCE_SORT = 'relevance';

const bySortOrder = (a: CategoryNode, b: CategoryNode): number => a.sortOrder - b.sortOrder;

/**
 * The top-level categories for the header and footer, in the admin's order. The shell must
 * render while the API is down, so a failure degrades to no categories instead of an error page.
 */
export const fetchTopCategories = async (): Promise<CategoryNode[]> => {
  try {
    const tree = await getJson<CategoryNode[]>(`${serverApiBaseUrl()}${CATEGORIES_PATH}`, {
      next: { revalidate: CATEGORY_TREE_REVALIDATE_SECONDS },
    });
    return [...tree].sort(bySortOrder);
  } catch (error) {
    console.error('Category tree unavailable; rendering the shell without it', error);
    return [];
  }
};

/** Relevance-ranked products for a free-text query, called from the browser. */
export const searchProducts = (
  query: string,
  signal?: AbortSignal,
): Promise<Paginated<ProductListItem>> => {
  const params = new URLSearchParams({
    search: query,
    sort: RELEVANCE_SORT,
    limit: String(SEARCH_RESULT_LIMIT),
  });
  return getJson<Paginated<ProductListItem>>(
    `${browserApiBaseUrl()}${PRODUCTS_PATH}?${params.toString()}`,
    signal ? { signal } : {},
  );
};

import type { ProductFilter } from './api/catalog';
import { ROUTES } from './routes';

/** Which slice of new arrivals the home page shows, read from its query string. */
export type HomeFilter = { kind: 'all' } | { kind: 'fresh' } | { kind: 'category'; slug: string };

/** The section the filter links jump to, below the sticky header. */
export const NEW_ARRIVALS_ID = 'new-arrivals';

/** How many products the home grid shows. */
export const HOME_PRODUCT_LIMIT = 8;

const CATEGORY_PARAM = 'category';
const FRESH_PARAM = 'fresh';
const FRESH_ON = '1';

/** Same rule the API enforces on `categorySlug` (catalog product-query DTO). */
const MAX_SLUG_LENGTH = 120;

type SearchParams = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Unknown or oversized values fall back to "all" instead of reaching the API. */
export const parseHomeFilter = (params: SearchParams): HomeFilter => {
  if (single(params[FRESH_PARAM]) === FRESH_ON) {
    return { kind: 'fresh' };
  }
  const slug = single(params[CATEGORY_PARAM])?.trim();
  if (slug && slug.length <= MAX_SLUG_LENGTH) {
    return { kind: 'category', slug };
  }
  return { kind: 'all' };
};

const queryFor = (filter: HomeFilter): Record<string, string> => {
  switch (filter.kind) {
    case 'all':
      return {};
    case 'fresh':
      return { [FRESH_PARAM]: FRESH_ON };
    case 'category':
      return { [CATEGORY_PARAM]: filter.slug };
  }
};

/** A link target for the i18n `Link`: the home page, filtered, scrolled to the grid. */
export const homeFilterHref = (filter: HomeFilter) => ({
  pathname: ROUTES.home,
  query: queryFor(filter),
  hash: NEW_ARRIVALS_ID,
});

export const isSameFilter = (a: HomeFilter, b: HomeFilter): boolean =>
  a.kind === b.kind && (a.kind !== 'category' || (b.kind === 'category' && a.slug === b.slug));

export const toProductFilter = (filter: HomeFilter): ProductFilter => {
  switch (filter.kind) {
    case 'all':
      return { limit: HOME_PRODUCT_LIMIT };
    case 'fresh':
      return { limit: HOME_PRODUCT_LIMIT, perishableOnly: true };
    case 'category':
      return { limit: HOME_PRODUCT_LIMIT, categorySlug: filter.slug };
  }
};

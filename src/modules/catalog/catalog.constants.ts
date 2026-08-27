/** Catalog-module constants. */
export const CatalogConstants = {
  /** Route segment this module is mounted on, under the global API prefix. */
  RouteBase: 'catalog',
  /** Resource label used in not-found messages. */
  ProductResourceName: 'Product',
  /** Search terms shorter than this are ignored rather than scanning the table. */
  MinSearchTermLength: 2,
} as const;

/** Sort orders a client may request on the product list. */
export const ProductSortOption = {
  Newest: 'newest',
  PriceAscending: 'price_asc',
  PriceDescending: 'price_desc',
  NameAscending: 'name_asc',
} as const;

export type ProductSort = (typeof ProductSortOption)[keyof typeof ProductSortOption];

/** Catalog-module constants. */
export const CatalogConstants = {
  /** Route segment this module is mounted on, under the global API prefix. */
  RouteBase: 'catalog',
  /** Resource label used in not-found messages. */
  ProductResourceName: 'Product',
  /** Search terms shorter than this are ignored rather than scanning the table. */
  MinSearchTermLength: 2,
  /**
   * Similarity a trigram match must reach to count as a hit, 0-1.
   *
   * 0.3 is Postgres's own default and tolerates roughly one typo in a short word. Lower and
   * "rice" starts matching "price"; higher and "almonds" stops matching "almond".
   */
  TrigramThreshold: 0.3,
  /** Cap on how many ranked ids one search pulls back before paging. */
  MaxSearchCandidates: 500,
} as const;

/** Sort orders a client may request on the product list. */
export const ProductSortOption = {
  Newest: 'newest',
  PriceAscending: 'price_asc',
  PriceDescending: 'price_desc',
  NameAscending: 'name_asc',
  /** Best match first. Only meaningful with a search term; ignored without one. */
  Relevance: 'relevance',
} as const;

export type ProductSort = (typeof ProductSortOption)[keyof typeof ProductSortOption];

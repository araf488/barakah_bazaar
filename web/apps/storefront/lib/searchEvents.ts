/** Window event any control can fire to open the header's search overlay. */
export const OPEN_SEARCH_EVENT = 'bb:open-search';

export interface OpenSearchDetail {
  /** Text to start with; the overlay opens empty without it. */
  query?: string;
}

/** Opens the search overlay from anywhere on the page, optionally with a query filled in. */
export const openSearch = (query?: string): void => {
  const detail: OpenSearchDetail = query ? { query } : {};
  window.dispatchEvent(new CustomEvent<OpenSearchDetail>(OPEN_SEARCH_EVENT, { detail }));
};

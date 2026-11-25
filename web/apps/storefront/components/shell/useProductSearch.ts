'use client';

import { useEffect, useState } from 'react';

import { type ProductListItem, searchProducts } from '../../lib/api/catalog';

/** Below this many characters a query matches too much to be useful. */
export const MIN_QUERY_LENGTH = 2;

/** Wait this long after the last keystroke before asking the API. */
export const SEARCH_DEBOUNCE_MS = 250;

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; items: ProductListItem[] }
  | { status: 'error' };

const IDLE: SearchState = { status: 'idle' };

/**
 * Debounced, cancellable product search. A newer query aborts the request in flight, so a slow
 * answer for "da" can never overwrite the results for "dates".
 */
export function useProductSearch(query: string): SearchState {
  const term = query.trim();
  const active = term.length >= MIN_QUERY_LENGTH;
  const [state, setState] = useState<SearchState>(IDLE);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      searchProducts(term, controller.signal)
        .then((page) => setState({ status: 'done', items: page.items }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({ status: 'error' });
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, active]);

  return active ? state : IDLE;
}

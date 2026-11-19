import { describe, expect, it, vi } from 'vitest';

import { OPEN_SEARCH_EVENT, openSearch } from '../searchEvents';

describe('openSearch', () => {
  const capture = () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_SEARCH_EVENT, listener);
    return {
      detail: () => (listener.mock.calls[0]?.[0] as CustomEvent).detail,
      stop: () => window.removeEventListener(OPEN_SEARCH_EVENT, listener),
    };
  };

  it('asks the header to open the search with a query', () => {
    const events = capture();
    openSearch('Doi');
    expect(events.detail()).toEqual({ query: 'Doi' });
    events.stop();
  });

  it('asks for an empty search when no query is given', () => {
    const events = capture();
    openSearch();
    expect(events.detail()).toEqual({});
    events.stop();
  });
});

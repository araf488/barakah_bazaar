import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, page, product } from '../../../test/fixtures';
import { useProductSearch } from '../useProductSearch';

describe('useProductSearch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stays idle, without calling the API, below two characters', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useProductSearch(' d '));

    expect(result.current).toEqual({ status: 'idle' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves from loading to the matches the API returns', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(page([product()]))));

    const { result } = renderHook(() => useProductSearch('ajwa'));

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current).toMatchObject({ items: [{ slug: 'ajwa-dates' }] });
  });

  it('cancels the request in flight when the query changes, so stale results never land', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderHook(({ q }) => useProductSearch(q), {
      initialProps: { q: 'da' },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ q: 'dates' });

    expect(signals[0]?.aborted).toBe(true);
  });

  it('sends one request for a burst of keystrokes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([])));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender, result } = renderHook(({ q }) => useProductSearch(q), {
      initialProps: { q: 'da' },
    });

    rerender({ q: 'dat' });
    rerender({ q: 'date' });
    rerender({ q: 'dates' });
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('search=dates');
  });
});

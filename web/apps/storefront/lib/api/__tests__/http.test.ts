import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { ApiRequestError, getJson } from '../http';

describe('getJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the parsed body of a 2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: 1 })));
    await expect(getJson('/api/v1/x')).resolves.toEqual({ ok: 1 });
  });

  it('asks for JSON and keeps the caller’s options and headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getJson('/api/v1/x', { next: { revalidate: 60 }, headers: { 'X-Device-Id': 'd1' } });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/x', {
      next: { revalidate: 60 },
      headers: { Accept: 'application/json', 'X-Device-Id': 'd1' },
    });
  });

  it('throws the status and path of a non-2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));

    const error = await getJson('/api/v1/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 503, path: '/api/v1/x' });
    expect((error as Error).message).toBe('API request failed with 503: /api/v1/x');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';

vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));

const { getMyReviews, getProductReviews, reviewsApi } = await import('../api');
const { accountCaller } = await import('../../account/caller');

const CALLER = { deviceId: 'd', accessToken: 'at' };
const PAGE = { items: [], total: 0, page: 1, pageSize: 6 };
const MINE = { awaiting: [], reviews: [] };

beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getProductReviews', () => {
  it('asks for the first page at the given size, with no session, cached for a minute', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PAGE));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProductReviews('prod-1', 12)).resolves.toEqual({ ok: true, page: PAGE });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: unknown }];
    expect(url).toBe('http://api.internal/api/v1/reviews/product/prod-1?page=1&pageSize=12');
    expect(init.next).toEqual({ revalidate: 60 });
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('turns a refusal or an unreachable API into a value the page can show', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(getProductReviews('prod-1', 6)).resolves.toEqual({ ok: false });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(getProductReviews('prod-1', 6)).resolves.toEqual({ ok: false });
  });
});

describe('reviewsApi', () => {
  it('reads the caller’s own reviews with their session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(MINE));
    vi.stubGlobal('fetch', fetchMock);

    await expect(reviewsApi.mine(CALLER)).resolves.toEqual({ ok: true, data: MINE });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/reviews/mine');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer at' });
  });

  it('posts a review and keeps the refusal message', async () => {
    const message = 'You have already reviewed this item.';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message }, 409));
    vi.stubGlobal('fetch', fetchMock);

    await expect(reviewsApi.create(CALLER, { orderItemId: 'line-1', rating: 5 })).resolves.toEqual({
      ok: false,
      status: 409,
      message,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/reviews');
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ orderItemId: 'line-1', rating: 5 }),
    });
  });
});

describe('getMyReviews', () => {
  it('answers not-ok without asking the API when nobody is signed in', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getMyReviews()).resolves.toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns both lists, or not-ok when the API refuses', async () => {
    vi.mocked(accountCaller).mockResolvedValue(CALLER);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(MINE)));
    await expect(getMyReviews()).resolves.toEqual({ ok: true, mine: MINE });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(getMyReviews()).resolves.toEqual({ ok: false });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { ordersApi } from '../api';

const CALLER = { deviceId: 'device-1', accessToken: 'at' };

const lastCall = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe('ordersApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1');
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('lists one page of every order', async () => {
    await ordersApi.list(CALLER, { status: null, page: 1, limit: 10 });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/orders?page=1&limit=10');
    expect(init.method).toBe('GET');
  });

  it('lists one status when filtered', async () => {
    await ordersApi.list(CALLER, { status: 'DELIVERED', page: 2, limit: 10 });
    expect(lastCall(fetchMock)[0]).toBe(
      'http://api.internal/api/v1/orders?page=2&limit=10&status=DELIVERED',
    );
  });

  it('cancels an order with the reason given', async () => {
    await ordersApi.cancel(CALLER, 'order 1', 'Ordered twice');
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/orders/order%201/cancel');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Ordered twice' });
  });

  it('sends no reason when none was given', async () => {
    await ordersApi.cancel(CALLER, 'order-1', null);
    expect(JSON.parse(String(lastCall(fetchMock)[1].body))).toEqual({});
  });

  it('keeps the API refusal message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'too late' }, 409));
    await expect(ordersApi.cancel(CALLER, 'order-1', null)).resolves.toEqual({
      ok: false,
      status: 409,
      message: 'too late',
    });
  });
});

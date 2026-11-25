import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { paymentsApi } from '../api';

const CALLER = { deviceId: 'device-1', accessToken: 'at' };

const lastCall = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe('paymentsApi', () => {
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

  it('asks which payment methods checkout may offer', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ methods: ['CASH_ON_DELIVERY'] }));
    await expect(paymentsApi.methods(CALLER)).resolves.toEqual({
      ok: true,
      data: { methods: ['CASH_ON_DELIVERY'] },
    });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/payments/methods');
    expect(init.method).toBe('GET');
  });

  it('starts a bKash payment for one order', async () => {
    await paymentsApi.startBkash(CALLER, 'order 1');
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/orders/order%201/payments/bkash');
    expect(init.method).toBe('POST');
  });

  it('moves an order to cash on delivery', async () => {
    await paymentsApi.switchToCod(CALLER, 'order-1');
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/orders/order-1/payment-method');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ paymentMethod: 'CASH_ON_DELIVERY' });
  });

  it('keeps the API refusal message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: 'The time to pay for this order has passed.' }, 409),
    );
    await expect(paymentsApi.startBkash(CALLER, 'order-1')).resolves.toEqual({
      ok: false,
      status: 409,
      message: 'The time to pay for this order has passed.',
    });
  });
});

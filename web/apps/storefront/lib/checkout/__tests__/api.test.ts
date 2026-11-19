import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { checkoutApi } from '../api';

const CALLER = { deviceId: 'device-1', accessToken: 'at' };

const lastCall = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe('checkoutApi', () => {
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

  it('asks for a week of delivery windows for one address', async () => {
    await checkoutApi.slots(CALLER, 'addr 1');
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/orders/delivery-slots?addressId=addr+1&days=7');
    expect(init.method).toBe('GET');
  });

  it('quotes delivery for a place and basket value', async () => {
    await checkoutApi.quote(
      CALLER,
      { division: 'Dhaka', district: 'Dhaka', unit: 'Gulshan' },
      250000,
    );
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/delivery/quote');
    expect(JSON.parse(String(init.body))).toEqual({
      division: 'Dhaka',
      district: 'Dhaka',
      unit: 'Gulshan',
      subtotalPoysha: 250000,
    });
  });

  it('previews a promo code against the basket and fee', async () => {
    await checkoutApi.previewPromotion(CALLER, 'EID10', 250000, 6000);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('http://api.internal/api/v1/promotions/preview');
    expect(JSON.parse(String(init.body))).toEqual({
      code: 'EID10',
      subtotalPoysha: 250000,
      deliveryFeePoysha: 6000,
    });
  });

  it('places an order and reads one back', async () => {
    await checkoutApi.place(CALLER, { addressId: 'addr-1', paymentMethod: 'CASH_ON_DELIVERY' });
    expect(lastCall(fetchMock)[0]).toBe('http://api.internal/api/v1/orders');
    expect(lastCall(fetchMock)[1].method).toBe('POST');

    await checkoutApi.order(CALLER, 'order/1');
    expect(lastCall(fetchMock)[0]).toBe('http://api.internal/api/v1/orders/order%2F1');
  });

  it('keeps the API message of a refused order', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Your basket is empty.' }, 409));
    await expect(
      checkoutApi.place(CALLER, { addressId: 'a', paymentMethod: 'CASH_ON_DELIVERY' }),
    ).resolves.toEqual({ ok: false, status: 409, message: 'Your basket is empty.' });
  });
});

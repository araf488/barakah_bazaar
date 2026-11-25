import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../test/checkout';

const AWAY = new Error('NEXT_REDIRECT');

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw AWAY;
  }),
}));
vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../api', () => ({ paymentsApi: { startBkash: vi.fn(), switchToCod: vi.fn() } }));

const { orderPaymentAction } = await import('../actions');
const { accountCaller } = await import('../../account/caller');
const { paymentsApi } = await import('../api');
const { refresh } = await import('next/cache');
const { redirect } = await import('next/navigation');

const CALLER = { deviceId: 'd', accessToken: 'at' };
const IDLE = { status: 'idle' } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
});

describe('orderPaymentAction', () => {
  it('opens a new bKash attempt and sends the browser to it', async () => {
    vi.mocked(paymentsApi.startBkash).mockResolvedValue({
      ok: true,
      data: { redirectUrl: 'https://pay.bkash.example/2', expiresInSeconds: 900 },
    });

    await expect(orderPaymentAction(IDLE, form({ orderId: 'order-1' }))).rejects.toBe(AWAY);
    expect(paymentsApi.startBkash).toHaveBeenCalledWith(CALLER, 'order-1');
    expect(redirect).toHaveBeenCalledWith('https://pay.bkash.example/2');
  });

  it('says why bKash would not start, and redraws the page', async () => {
    vi.mocked(paymentsApi.startBkash).mockResolvedValue({
      ok: false,
      status: 409,
      message: 'The time to pay for this order has passed.',
    });

    await expect(orderPaymentAction(IDLE, form({ orderId: 'order-1' }))).resolves.toMatchObject({
      status: 'error',
      error: 'windowClosed',
    });
    expect(refresh).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('refuses to follow an address that is not a web page', async () => {
    vi.mocked(paymentsApi.startBkash).mockResolvedValue({
      ok: true,
      data: { redirectUrl: 'javascript:alert(1)', expiresInSeconds: 900 },
    });
    await expect(orderPaymentAction(IDLE, form({ orderId: 'order-1' }))).resolves.toMatchObject({
      error: 'gateway',
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('moves the order to cash on delivery and redraws the page', async () => {
    vi.mocked(paymentsApi.switchToCod).mockResolvedValue({ ok: true, data: order() });

    await expect(
      orderPaymentAction(IDLE, form({ orderId: 'order-1', intent: 'cod' })),
    ).resolves.toEqual({ status: 'switched' });
    expect(paymentsApi.switchToCod).toHaveBeenCalledWith(CALLER, 'order-1');
    expect(paymentsApi.startBkash).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('says why the switch was refused', async () => {
    vi.mocked(paymentsApi.switchToCod).mockResolvedValue({
      ok: false,
      status: 409,
      message: 'This order can no longer switch to cash on delivery.',
    });
    await expect(
      orderPaymentAction(IDLE, form({ orderId: 'order-1', intent: 'cod' })),
    ).resolves.toMatchObject({ status: 'error', error: 'cannotSwitch' });
  });

  it('refuses without an order or a session, without calling the API', async () => {
    await expect(orderPaymentAction(IDLE, form({}))).resolves.toMatchObject({ error: 'gone' });
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(orderPaymentAction(IDLE, form({ orderId: 'o' }))).resolves.toMatchObject({
      error: 'signedOut',
    });
    await expect(
      orderPaymentAction(IDLE, form({ orderId: 'o', intent: 'cod' })),
    ).resolves.toMatchObject({ error: 'signedOut' });
    expect(paymentsApi.startBkash).not.toHaveBeenCalled();
    expect(paymentsApi.switchToCod).not.toHaveBeenCalled();
  });
});

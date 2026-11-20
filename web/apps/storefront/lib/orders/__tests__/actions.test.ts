import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../test/checkout';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../api', () => ({ ordersApi: { cancel: vi.fn() } }));

const { cancelOrderAction } = await import('../actions');
const { accountCaller } = await import('../../account/caller');
const { ordersApi } = await import('../api');
const { refresh } = await import('next/cache');

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

describe('cancelOrderAction', () => {
  it('cancels with the trimmed reason and redraws the page', async () => {
    vi.mocked(ordersApi.cancel).mockResolvedValue({
      ok: true,
      data: order({ status: 'CANCELLED' }),
    });

    await expect(
      cancelOrderAction(IDLE, form({ orderId: 'order-1', reason: '  Ordered twice ' })),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(ordersApi.cancel).toHaveBeenCalledWith(CALLER, 'order-1', 'Ordered twice');
    expect(refresh).toHaveBeenCalled();
  });

  it('sends no reason when the field was left empty, and cuts a long one to the limit', async () => {
    vi.mocked(ordersApi.cancel).mockResolvedValue({ ok: true, data: order() });
    await cancelOrderAction(IDLE, form({ orderId: 'order-1', reason: '   ' }));
    expect(ordersApi.cancel).toHaveBeenLastCalledWith(CALLER, 'order-1', null);

    await cancelOrderAction(IDLE, form({ orderId: 'order-1', reason: 'x'.repeat(600) }));
    expect(ordersApi.cancel).toHaveBeenLastCalledWith(CALLER, 'order-1', 'x'.repeat(500));
  });

  it('says it is too late, and redraws so the page shows where the order is', async () => {
    vi.mocked(ordersApi.cancel).mockResolvedValue({
      ok: false,
      status: 409,
      message: 'This order has already been dispatched and can no longer be cancelled.',
    });
    const state = await cancelOrderAction(IDLE, form({ orderId: 'order-1' }));
    expect(state).toMatchObject({ status: 'error', error: 'tooLate' });
    expect(refresh).toHaveBeenCalled();
  });

  it('refuses without an order or a session, without calling the API', async () => {
    await expect(cancelOrderAction(IDLE, form({}))).resolves.toMatchObject({
      status: 'error',
      error: 'gone',
    });
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(cancelOrderAction(IDLE, form({ orderId: 'order-1' }))).resolves.toMatchObject({
      status: 'error',
      error: 'signedOut',
    });
    expect(ordersApi.cancel).not.toHaveBeenCalled();
  });
});

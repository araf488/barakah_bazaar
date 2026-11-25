import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../test/checkout';
import { page } from '../../../test/fixtures';

vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../../orders/api', () => ({ ordersApi: { list: vi.fn() } }));

const { findOrderByNumber } = await import('../findOrder');
const { accountCaller } = await import('../../account/caller');
const { ordersApi } = await import('../../orders/api');

const CALLER = { deviceId: 'd', accessToken: 'at' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
});

describe('findOrderByNumber', () => {
  it('finds the order among the newest twenty', async () => {
    const wanted = order({ id: 'order-2', orderNumber: 'BB-2' });
    vi.mocked(ordersApi.list).mockResolvedValue({
      ok: true,
      data: page([order({ orderNumber: 'BB-1' }), wanted]),
    });

    await expect(findOrderByNumber('BB-2')).resolves.toBe(wanted);
    expect(ordersApi.list).toHaveBeenCalledWith(CALLER, { status: null, page: 1, limit: 20 });
  });

  it('answers null when it is not there, the API fails, or nobody is signed in', async () => {
    vi.mocked(ordersApi.list).mockResolvedValue({ ok: true, data: page([order()]) });
    await expect(findOrderByNumber('BB-9')).resolves.toBeNull();

    vi.mocked(ordersApi.list).mockResolvedValue({ ok: false, status: 503, message: null });
    await expect(findOrderByNumber('BB-20261119-0001')).resolves.toBeNull();

    vi.mocked(accountCaller).mockResolvedValue(null);
    vi.mocked(ordersApi.list).mockClear();
    await expect(findOrderByNumber('BB-20261119-0001')).resolves.toBeNull();
    expect(ordersApi.list).not.toHaveBeenCalled();
  });
});

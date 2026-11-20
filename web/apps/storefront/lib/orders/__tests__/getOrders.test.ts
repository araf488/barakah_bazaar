import { beforeEach, describe, expect, it, vi } from 'vitest';

import { page } from '../../../test/fixtures';
import { order } from '../../../test/checkout';

vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../api', () => ({ ordersApi: { list: vi.fn() } }));

const { getOrders } = await import('../getOrders');
const { accountCaller } = await import('../../account/caller');
const { ordersApi } = await import('../api');

const CALLER = { deviceId: 'd', accessToken: 'at' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
});

describe('getOrders', () => {
  it('asks for one page of ten, filtered by the chosen status', async () => {
    const orders = page([order()]);
    vi.mocked(ordersApi.list).mockResolvedValue({ ok: true, data: orders });

    await expect(getOrders({ filter: 'DELIVERED', page: 2 })).resolves.toEqual({
      ok: true,
      page: orders,
    });
    expect(ordersApi.list).toHaveBeenCalledWith(CALLER, {
      status: 'DELIVERED',
      page: 2,
      limit: 10,
    });
  });

  it('asks for every status on the unfiltered list', async () => {
    vi.mocked(ordersApi.list).mockResolvedValue({ ok: true, data: page([]) });
    await getOrders({ filter: 'all', page: 1 });
    expect(ordersApi.list).toHaveBeenCalledWith(CALLER, { status: null, page: 1, limit: 10 });
  });

  it('fails without a session, without calling the API', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(getOrders({ filter: 'all', page: 1 })).resolves.toEqual({ ok: false });
    expect(ordersApi.list).not.toHaveBeenCalled();
  });

  it('fails when the API refuses or cannot be reached', async () => {
    vi.mocked(ordersApi.list).mockResolvedValue({ ok: false, status: 503, message: null });
    await expect(getOrders({ filter: 'all', page: 1 })).resolves.toEqual({ ok: false });
  });
});

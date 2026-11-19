import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../test/checkout';

vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../api', () => ({ checkoutApi: { order: vi.fn() } }));

const { getOrder } = await import('../getOrder');
const { accountCaller } = await import('../../account/caller');
const { checkoutApi } = await import('../api');

beforeEach(() => vi.clearAllMocks());

describe('getOrder', () => {
  it('reads the order for the signed-in shopper', async () => {
    vi.mocked(accountCaller).mockResolvedValue({ deviceId: 'd', accessToken: 'at' });
    vi.mocked(checkoutApi.order).mockResolvedValue({ ok: true, data: order() });
    await expect(getOrder('order-1')).resolves.toEqual(order());
  });

  it('is null when it is not theirs or nobody is signed in', async () => {
    vi.mocked(accountCaller).mockResolvedValue({ deviceId: 'd', accessToken: 'at' });
    vi.mocked(checkoutApi.order).mockResolvedValue({ ok: false, status: 404 });
    await expect(getOrder('order-x')).resolves.toBeNull();

    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(getOrder('order-1')).resolves.toBeNull();
  });
});

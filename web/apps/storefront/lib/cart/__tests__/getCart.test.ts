import { beforeEach, describe, expect, it, vi } from 'vitest';

import { serverCart } from '../../../test/cart';
import { fakeJar } from '../../../test/cookieJar';
import { productDetail } from '../../../test/productDetail';

const jar = { current: fakeJar() };
vi.mock('next/headers', () => ({
  cookies: async () => jar.current,
  headers: async () => new Headers({ 'user-agent': 'UA' }),
}));
vi.mock('../../auth/session', () => ({ getCurrentUser: vi.fn() }));
vi.mock('../api', () => ({ cartApi: { get: vi.fn() } }));
vi.mock('../../api/catalog', () => ({ getProductBySlug: vi.fn() }));

const { getCart } = await import('../getCart');
const { getCurrentUser } = await import('../../auth/session');
const { cartApi } = await import('../api');
const { getProductBySlug } = await import('../../api/catalog');

beforeEach(() => vi.clearAllMocks());

describe('getCart', () => {
  it('is an empty guest cart for a new visitor, with no API calls', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    jar.current = fakeJar();

    await expect(getCart()).resolves.toMatchObject({ mode: 'guest', lines: [], itemCount: 0 });
    expect(getProductBySlug).not.toHaveBeenCalled();
  });

  it('prices a guest cart, looking each product up once', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    jar.current = fakeJar({
      bb_guest_cart: JSON.stringify([
        { s: 'ajwa-dates', v: 'v-250', q: 1 },
        { s: 'ajwa-dates', v: 'v-500', q: 1 },
      ]),
    });
    vi.mocked(getProductBySlug).mockResolvedValue({ ok: true, product: productDetail() });

    const cart = await getCart();

    expect(getProductBySlug).toHaveBeenCalledTimes(1);
    expect(cart).toMatchObject({ mode: 'guest', itemCount: 2, subtotalFormatted: '৳1,900.00' });
  });

  it('reads the account cart once signed in', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'u1' } as never);
    jar.current = fakeJar({ bb_device: 'd', bb_session: 'at' });
    vi.mocked(cartApi.get).mockResolvedValue({ ok: true, data: serverCart() });

    await expect(getCart()).resolves.toMatchObject({ mode: 'account', itemCount: 2 });
    expect(cartApi.get).toHaveBeenCalledWith({ deviceId: 'd', accessToken: 'at', userAgent: 'UA' });
  });

  it('reports an account cart it could not load', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'u1' } as never);
    jar.current = fakeJar({ bb_device: 'd', bb_session: 'at' });
    vi.mocked(cartApi.get).mockResolvedValue({ ok: false, status: 503 });

    await expect(getCart()).resolves.toMatchObject({ mode: 'account', status: 'error' });
  });
});

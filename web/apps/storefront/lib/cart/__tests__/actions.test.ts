import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';
import { productDetail, variant } from '../../../test/productDetail';

const jar = { current: fakeJar() };
vi.mock('next/headers', () => ({
  cookies: async () => jar.current,
  headers: async () => new Headers({ 'user-agent': 'UA' }),
}));
vi.mock('../../auth/session', () => ({ getCurrentUser: vi.fn() }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'bn') }));
vi.mock('../../../i18n/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('../../api/catalog', () => ({ getProductBySlug: vi.fn() }));
vi.mock('../api', () => ({ cartApi: { add: vi.fn(), update: vi.fn(), remove: vi.fn() } }));

const { addToCartAction, quickAddAction, setQuantityAction } = await import('../actions');
const { getProductBySlug } = await import('../../api/catalog');
const { redirect } = await import('../../../i18n/navigation');
const { getCurrentUser } = await import('../../auth/session');
const { cartApi } = await import('../api');
const { refresh } = await import('next/cache');

const IDLE = { status: 'idle' } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const guestLines = () => JSON.parse(jar.current.values.get('bb_guest_cart') ?? '[]');
const ACCOUNT_CALLER = { deviceId: 'd', userAgent: 'UA', accessToken: 'at' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  jar.current = fakeJar({ bb_device: 'd' });
});

describe('addToCartAction as a guest', () => {
  it('keeps the line in the guest cookie, httpOnly', async () => {
    const state = await addToCartAction(
      IDLE,
      form({ slug: 'ajwa', variantId: 'v1', quantity: '2' }),
    );

    expect(state.status).toBe('added');
    expect(guestLines()).toEqual([{ s: 'ajwa', v: 'v1', q: 2 }]);
    expect(jar.current.options.get('bb_guest_cart')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
    });
    expect(cartApi.add).not.toHaveBeenCalled();
  });

  it('refuses a 21st product with a reason', async () => {
    jar.current = fakeJar({
      bb_device: 'd',
      bb_guest_cart: JSON.stringify(
        Array.from({ length: 20 }, (_, i) => ({ s: 's', v: `v${i}`, q: 1 })),
      ),
    });
    await expect(
      addToCartAction(IDLE, form({ slug: 's', variantId: 'new', quantity: '1' })),
    ).resolves.toEqual({ status: 'error', error: 'guestFull' });
  });

  it.each([['0'], ['100'], ['1.5'], ['abc']])('refuses the quantity %s', async (quantity) => {
    await expect(
      addToCartAction(IDLE, form({ slug: 's', variantId: 'v', quantity })),
    ).resolves.toEqual({ status: 'error', error: 'quantity' });
  });
});

describe('addToCartAction when signed in', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'u1' } as never);
    jar.current = fakeJar({ bb_device: 'd', bb_session: 'at' });
  });

  it('adds to the account cart through the API', async () => {
    vi.mocked(cartApi.add).mockResolvedValue({ ok: true, data: {} as never });

    const state = await addToCartAction(
      IDLE,
      form({ slug: 'ajwa', variantId: 'v1', quantity: '3' }),
    );

    expect(state.status).toBe('added');
    expect(cartApi.add).toHaveBeenCalledWith(ACCOUNT_CALLER, 'v1', 3);
    expect(jar.current.values.has('bb_guest_cart')).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, 'unavailable'],
    [409, 'stock'],
    [500, 'failed'],
  ])('maps the API’s %i to %s', async (status, error) => {
    vi.mocked(cartApi.add).mockResolvedValue({ ok: false, status });
    await expect(
      addToCartAction(IDLE, form({ slug: 'a', variantId: 'v', quantity: '1' })),
    ).resolves.toEqual({ status: 'error', error });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('setQuantityAction', () => {
  it('updates a guest line, and removes it at zero', async () => {
    jar.current = fakeJar({
      bb_device: 'd',
      bb_guest_cart: JSON.stringify([
        { s: 'a', v: 'v1', q: 2 },
        { s: 'b', v: 'v2', q: 1 },
      ]),
    });

    await setQuantityAction(form({ key: 'v1', quantity: '5' }));
    expect(guestLines()).toEqual([
      { s: 'a', v: 'v1', q: 5 },
      { s: 'b', v: 'v2', q: 1 },
    ]);

    await setQuantityAction(form({ key: 'v1', quantity: '0' }));
    await setQuantityAction(form({ key: 'v2', quantity: '0' }));
    expect(jar.current.values.has('bb_guest_cart')).toBe(false);
  });

  it('patches an account line, and deletes it at zero', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'u1' } as never);
    jar.current = fakeJar({ bb_device: 'd', bb_session: 'at' });

    await setQuantityAction(form({ key: 'item-1', quantity: '4' }));
    await setQuantityAction(form({ key: 'item-1', quantity: '0' }));

    expect(cartApi.update).toHaveBeenCalledWith(ACCOUNT_CALLER, 'item-1', 4);
    expect(cartApi.remove).toHaveBeenCalledWith(ACCOUNT_CALLER, 'item-1');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores a malformed request', async () => {
    await setQuantityAction(form({ key: '', quantity: '1' }));
    await setQuantityAction(form({ key: 'v1', quantity: '-1' }));
    expect(jar.current.set).not.toHaveBeenCalled();
  });
});

describe('quickAddAction', () => {
  it('adds one of a single-size product straight to the cart', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({
      ok: true,
      product: productDetail({ variants: [variant()] }),
    });

    const state = await quickAddAction(IDLE, form({ slug: 'ajwa-dates' }));

    expect(state.status).toBe('added');
    expect(guestLines()).toEqual([{ s: 'ajwa-dates', v: 'v-500', q: 1 }]);
  });

  it('opens the product page for a product with several sizes, adding nothing', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({ ok: true, product: productDetail() });

    await expect(quickAddAction(IDLE, form({ slug: 'ajwa-dates' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(redirect).toHaveBeenCalledWith({ href: '/p/ajwa-dates', locale: 'bn' });
    expect(jar.current.values.has('bb_guest_cart')).toBe(false);
  });

  it('says the item is unavailable when the product is gone', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({ ok: false, notFound: true });
    await expect(quickAddAction(IDLE, form({ slug: 'gone' }))).resolves.toEqual({
      status: 'error',
      error: 'unavailable',
    });
  });
});

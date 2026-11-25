import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';

vi.mock('../api', () => ({ cartApi: { add: vi.fn() } }));
const { mergeGuestCart } = await import('../merge');
const { cartApi } = await import('../api');

const CALLER = { deviceId: 'd', accessToken: 'at' };

describe('mergeGuestCart', () => {
  beforeEach(() => vi.mocked(cartApi.add).mockReset());

  it('adds each guest line to the account cart in order, then clears the guest cookie', async () => {
    const jar = fakeJar({
      bb_guest_cart: JSON.stringify([
        { s: 'a', v: 'v1', q: 2 },
        { s: 'b', v: 'v2', q: 1 },
      ]),
    });
    vi.mocked(cartApi.add).mockResolvedValue({ ok: true, data: {} as never });

    await expect(mergeGuestCart(jar, CALLER)).resolves.toEqual({ moved: 2, refused: 0 });

    expect(vi.mocked(cartApi.add).mock.calls).toEqual([
      [CALLER, 'v1', 2],
      [CALLER, 'v2', 1],
    ]);
    expect(jar.values.has('bb_guest_cart')).toBe(false);
  });

  it('drops lines the API refuses (gone, out of stock) and still clears the cookie', async () => {
    const jar = fakeJar({
      bb_guest_cart: JSON.stringify([
        { s: 'a', v: 'v1', q: 2 },
        { s: 'b', v: 'v2', q: 1 },
      ]),
    });
    vi.mocked(cartApi.add)
      .mockResolvedValueOnce({ ok: false, status: 409 })
      .mockResolvedValueOnce({ ok: true, data: {} as never });

    await expect(mergeGuestCart(jar, CALLER)).resolves.toEqual({ moved: 1, refused: 1 });
    expect(jar.values.has('bb_guest_cart')).toBe(false);
  });

  it('does nothing without a guest cart', async () => {
    const jar = fakeJar();
    await expect(mergeGuestCart(jar, CALLER)).resolves.toEqual({ moved: 0, refused: 0 });
    expect(cartApi.add).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });
});

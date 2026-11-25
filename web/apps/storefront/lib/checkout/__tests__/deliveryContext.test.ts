import { beforeEach, describe, expect, it, vi } from 'vitest';

import { address } from '../../../test/address';
import { serverCart } from '../../../test/cart';
import { quote } from '../../../test/checkout';

vi.mock('../../account/addresses', () => ({ getAddressBook: vi.fn() }));
vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../../cart/getCart', () => ({ getCart: vi.fn() }));
vi.mock('../delivery', () => ({ quoteFor: vi.fn() }));

const { getDeliveryContext } = await import('../deliveryContext');
const { getAddressBook } = await import('../../account/addresses');
const { accountCaller } = await import('../../account/caller');
const { getCart } = await import('../../cart/getCart');
const { quoteFor } = await import('../delivery');
const { emptyCart, fromServerCart } = await import('../../cart/view');

const CALLER = { deviceId: 'd', accessToken: 'at' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
  vi.mocked(getCart).mockResolvedValue(fromServerCart(serverCart()));
  vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [address()] });
});

describe('getDeliveryContext', () => {
  it('names the default address area and what delivering the cart there costs', async () => {
    vi.mocked(quoteFor).mockResolvedValue({
      ok: true,
      quote: quote({ feePoysha: 6000, freeDeliveryShortfallPoysha: 50000 }),
    });

    await expect(getDeliveryContext()).resolves.toEqual({
      place: 'Banani',
      feePoysha: 6000,
      isFree: false,
      shortfallPoysha: 50000,
    });
  });

  it('falls back to the upazila when the address has no area', async () => {
    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [address({ area: null })] });
    vi.mocked(getCart).mockResolvedValue(emptyCart('account'));

    await expect(getDeliveryContext()).resolves.toEqual({
      place: 'Gulshan',
      feePoysha: null,
      isFree: false,
      shortfallPoysha: 0,
    });
    expect(quoteFor).not.toHaveBeenCalled();
  });

  it('keeps the area when the quote fails', async () => {
    vi.mocked(quoteFor).mockResolvedValue({ ok: false, error: 'noZone' });
    await expect(getDeliveryContext()).resolves.toMatchObject({ place: 'Banani', feePoysha: null });
  });

  it('is null for a guest or a shopper with no saved address', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(getDeliveryContext()).resolves.toBeNull();

    vi.mocked(accountCaller).mockResolvedValue(CALLER);
    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [] });
    await expect(getDeliveryContext()).resolves.toBeNull();
  });
});

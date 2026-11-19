import { beforeEach, describe, expect, it, vi } from 'vitest';

import { address } from '../../../test/address';
import { serverCart } from '../../../test/cart';
import { quote, slot } from '../../../test/checkout';

vi.mock('../../account/addresses', () => ({ getAddressBook: vi.fn() }));
vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../../cart/getCart', () => ({ getCart: vi.fn() }));
vi.mock('../delivery', () => ({ quoteFor: vi.fn(), slotsFor: vi.fn() }));

const { getCheckout } = await import('../getCheckout');
const { getAddressBook } = await import('../../account/addresses');
const { accountCaller } = await import('../../account/caller');
const { getCart } = await import('../../cart/getCart');
const { quoteFor, slotsFor } = await import('../delivery');
const { emptyCart, fromServerCart } = await import('../../cart/view');

const CALLER = { deviceId: 'd', accessToken: 'at' };
const HOME = address();
const OFFICE = address({ id: 'addr-2', isDefault: false, unit: 'Motijheel', area: null });
const CART = fromServerCart(serverCart());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
  vi.mocked(getCart).mockResolvedValue(CART);
  vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [HOME, OFFICE] });
  vi.mocked(quoteFor).mockResolvedValue({ ok: true, quote: quote() });
  vi.mocked(slotsFor).mockResolvedValue({ ok: true, slots: [slot()] });
});

describe('getCheckout', () => {
  it('delivers to the default address unless another is asked for', async () => {
    await expect(getCheckout(undefined)).resolves.toMatchObject({ selected: HOME });
    await expect(getCheckout('addr-2')).resolves.toMatchObject({ selected: OFFICE });
    await expect(getCheckout('someone-elses')).resolves.toMatchObject({ selected: HOME });
  });

  it('quotes and lists windows for the chosen address and the cart value', async () => {
    const data = await getCheckout('addr-2');

    expect(quoteFor).toHaveBeenCalledWith(CALLER, OFFICE, CART.subtotalPoysha);
    expect(slotsFor).toHaveBeenCalledWith(CALLER, 'addr-2');
    expect(data.quote).toEqual({ ok: true, quote: quote() });
    expect(data.slots).toEqual({ ok: true, slots: [slot()] });
  });

  it('asks nothing of delivery without an address or with an empty cart', async () => {
    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [] });
    await expect(getCheckout(undefined)).resolves.toMatchObject({
      addresses: [],
      selected: null,
      quote: null,
      slots: null,
    });

    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [HOME] });
    vi.mocked(getCart).mockResolvedValue(emptyCart('account'));
    await expect(getCheckout(undefined)).resolves.toMatchObject({ quote: null, slots: null });
    expect(quoteFor).not.toHaveBeenCalled();
  });

  it('reports an unreadable address book as null', async () => {
    vi.mocked(getAddressBook).mockResolvedValue({ ok: false });
    await expect(getCheckout(undefined)).resolves.toMatchObject({
      addresses: null,
      selected: null,
    });
  });
});

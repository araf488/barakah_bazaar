import { beforeEach, describe, expect, it, vi } from 'vitest';

import { address } from '../../../test/address';
import { quote, slot } from '../../../test/checkout';

vi.mock('../api', () => ({ checkoutApi: { quote: vi.fn(), slots: vi.fn() } }));

const { quoteFor, slotsFor } = await import('../delivery');
const { checkoutApi } = await import('../api');

const CALLER = { deviceId: 'd', accessToken: 'at' };

beforeEach(() => vi.clearAllMocks());

describe('quoteFor', () => {
  it('quotes the address place names and the basket value', async () => {
    vi.mocked(checkoutApi.quote).mockResolvedValue({ ok: true, data: quote() });

    await expect(quoteFor(CALLER, address(), 250000)).resolves.toEqual({
      ok: true,
      quote: quote(),
    });
    expect(checkoutApi.quote).toHaveBeenCalledWith(
      CALLER,
      { division: 'Dhaka', district: 'Dhaka', unit: 'Gulshan' },
      250000,
    );
  });

  it('turns a refusal into the reason to show', async () => {
    vi.mocked(checkoutApi.quote).mockResolvedValue({
      ok: false,
      status: 422,
      message: 'Delivery is not available to that address yet. Please contact support.',
    });
    await expect(quoteFor(CALLER, address(), 1)).resolves.toEqual({ ok: false, error: 'noZone' });
  });
});

describe('slotsFor', () => {
  it('returns the windows', async () => {
    vi.mocked(checkoutApi.slots).mockResolvedValue({ ok: true, data: [slot()] });
    await expect(slotsFor(CALLER, 'addr-1')).resolves.toEqual({ ok: true, slots: [slot()] });
  });

  it('says why no hub can serve the basket there', async () => {
    vi.mocked(checkoutApi.slots).mockResolvedValue({
      ok: false,
      status: 409,
      message: 'We cannot deliver to that address right now.',
    });
    await expect(slotsFor(CALLER, 'addr-1')).resolves.toEqual({
      ok: false,
      error: 'noWarehouse',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { address } from '../../../test/address';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('../caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../api', () => ({
  addressApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn(), setDefault: vi.fn() },
}));

const { saveAddressAction, deleteAddressAction, setDefaultAddressAction } =
  await import('../actions');
const { accountCaller } = await import('../caller');
const { addressApi } = await import('../api');
const { refresh } = await import('next/cache');

const CALLER = { deviceId: 'd', accessToken: 'at' };
const IDLE = { status: 'idle' } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const VALID = {
  label: 'Home',
  recipientName: ' Tahmina Rahman ',
  phone: '০১৭১২-৩৪৫৬৭৮',
  division: 'Dhaka',
  district: 'Dhaka',
  unit: 'Gulshan',
  area: 'Banani',
  addressLine: 'House 12, Road 4',
  postCode: '1213',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
});

describe('saveAddressAction', () => {
  it('creates an address with a normalized phone and trimmed fields', async () => {
    vi.mocked(addressApi.create).mockResolvedValue({ ok: true, data: address() });

    const state = await saveAddressAction(IDLE, form(VALID));

    expect(state.status).toBe('saved');
    expect(addressApi.create).toHaveBeenCalledWith(CALLER, {
      label: 'Home',
      recipientName: 'Tahmina Rahman',
      phone: '01712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      unit: 'Gulshan',
      area: 'Banani',
      addressLine: 'House 12, Road 4',
      postCode: '1213',
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('updates the address named by id', async () => {
    vi.mocked(addressApi.update).mockResolvedValue({ ok: true, data: address() });
    await saveAddressAction(IDLE, form({ ...VALID, id: 'addr-1' }));
    expect(addressApi.update).toHaveBeenCalledWith(
      CALLER,
      'addr-1',
      expect.objectContaining({ unit: 'Gulshan' }),
    );
    expect(addressApi.create).not.toHaveBeenCalled();
  });

  it('sends an unlisted place without the optional fields', async () => {
    vi.mocked(addressApi.create).mockResolvedValue({ ok: true, data: address() });
    await saveAddressAction(
      IDLE,
      form({
        ...VALID,
        area: '',
        postCode: '',
        label: '',
        unit: 'Kachukhet',
        unlistedLocation: 'on',
      }),
    );
    expect(vi.mocked(addressApi.create).mock.calls[0]?.[1]).toEqual({
      recipientName: 'Tahmina Rahman',
      phone: '01712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      unit: 'Kachukhet',
      addressLine: 'House 12, Road 4',
      unlistedLocation: true,
    });
  });

  it('refuses an invalid form without calling the API', async () => {
    await expect(saveAddressAction(IDLE, form({ ...VALID, phone: '123' }))).resolves.toEqual({
      status: 'error',
      error: 'phoneInvalid',
    });
    expect(addressApi.create).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'invalid'],
    [401, 'signedOut'],
    [404, 'notFound'],
    [409, 'tooMany'],
    [500, 'failed'],
  ])('maps the API’s %i to %s', async (status, error) => {
    vi.mocked(addressApi.create).mockResolvedValue({ ok: false, status });
    await expect(saveAddressAction(IDLE, form(VALID))).resolves.toEqual({ status: 'error', error });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks to sign in again when the session is gone', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(saveAddressAction(IDLE, form(VALID))).resolves.toEqual({
      status: 'error',
      error: 'signedOut',
    });
  });
});

describe('deleteAddressAction and setDefaultAddressAction', () => {
  it('remove and set the default by id, then redraw', async () => {
    vi.mocked(addressApi.remove).mockResolvedValue({ ok: true, data: undefined });
    vi.mocked(addressApi.setDefault).mockResolvedValue({ ok: true, data: address() });

    await deleteAddressAction(form({ id: 'addr-2' }));
    await setDefaultAddressAction(form({ id: 'addr-3' }));

    expect(addressApi.remove).toHaveBeenCalledWith(CALLER, 'addr-2');
    expect(addressApi.setDefault).toHaveBeenCalledWith(CALLER, 'addr-3');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('do nothing without a session or an id', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    await deleteAddressAction(form({ id: 'addr-2' }));
    vi.mocked(accountCaller).mockResolvedValue(CALLER);
    await setDefaultAddressAction(form({ id: '' }));
    expect(addressApi.remove).not.toHaveBeenCalled();
    expect(addressApi.setDefault).not.toHaveBeenCalled();
  });
});

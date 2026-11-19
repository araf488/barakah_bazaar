import { describe, expect, it, vi } from 'vitest';

import { address } from '../../../test/address';

vi.mock('../caller', () => ({
  accountCaller: vi.fn(async () => ({ deviceId: 'd', accessToken: 'at' })),
}));
vi.mock('../api', () => ({ addressApi: { list: vi.fn() } }));

const { getAddressBook } = await import('../addresses');
const { addressApi } = await import('../api');
const { accountCaller } = await import('../caller');

describe('getAddressBook', () => {
  it('puts the default address first', async () => {
    vi.mocked(addressApi.list).mockResolvedValue({
      ok: true,
      data: [address({ id: 'a', isDefault: false }), address({ id: 'b', isDefault: true })],
    });
    const book = await getAddressBook();
    expect(book.ok && book.addresses.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('reports a failed load as a value', async () => {
    vi.mocked(addressApi.list).mockResolvedValue({ ok: false, status: 503 });
    await expect(getAddressBook()).resolves.toEqual({ ok: false });
  });

  it('has nothing to show without a session', async () => {
    vi.mocked(accountCaller).mockResolvedValueOnce(null);
    await expect(getAddressBook()).resolves.toEqual({ ok: false });
  });
});

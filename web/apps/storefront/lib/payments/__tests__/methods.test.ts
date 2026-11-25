import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../api', () => ({ paymentsApi: { methods: vi.fn() } }));

const { getPaymentMethods } = await import('../methods');
const { accountCaller } = await import('../../account/caller');
const { paymentsApi } = await import('../api');

const CALLER = { deviceId: 'd', accessToken: 'at' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
});

describe('getPaymentMethods', () => {
  it('offers what the API lists', async () => {
    vi.mocked(paymentsApi.methods).mockResolvedValue({
      ok: true,
      data: { methods: ['CASH_ON_DELIVERY', 'BKASH'] },
    });
    await expect(getPaymentMethods()).resolves.toEqual(['CASH_ON_DELIVERY', 'BKASH']);
  });

  it('falls back to cash alone when the API cannot say, never to bKash', async () => {
    vi.mocked(paymentsApi.methods).mockResolvedValue({ ok: false, status: 503, message: null });
    await expect(getPaymentMethods()).resolves.toEqual(['CASH_ON_DELIVERY']);

    vi.mocked(paymentsApi.methods).mockResolvedValue({ ok: true, data: { methods: [] } });
    await expect(getPaymentMethods()).resolves.toEqual(['CASH_ON_DELIVERY']);
  });

  it('offers cash alone without a session, without calling the API', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(getPaymentMethods()).resolves.toEqual(['CASH_ON_DELIVERY']);
    expect(paymentsApi.methods).not.toHaveBeenCalled();
  });
});

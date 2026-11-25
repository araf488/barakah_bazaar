import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../test/checkout';

const REDIRECTED = new Error('NEXT_REDIRECT');
const AWAY = new Error('NEXT_REDIRECT_EXTERNAL');

vi.mock('next/cache', () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'bn') }));
vi.mock('../../../i18n/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw AWAY;
  }),
}));
vi.mock('../api', () => ({ checkoutApi: { previewPromotion: vi.fn(), place: vi.fn() } }));
vi.mock('../../payments/api', () => ({ paymentsApi: { startBkash: vi.fn() } }));
vi.mock('../../payments/methods', () => ({ getPaymentMethods: vi.fn() }));

const { previewPromoAction, placeOrderAction } = await import('../actions');
const { accountCaller } = await import('../../account/caller');
const { checkoutApi } = await import('../api');
const { refresh, revalidatePath } = await import('next/cache');
const { redirect } = await import('../../../i18n/navigation');
const { redirect: redirectAway } = await import('next/navigation');
const { paymentsApi } = await import('../../payments/api');
const { getPaymentMethods } = await import('../../payments/methods');

const CALLER = { deviceId: 'd', accessToken: 'at' };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const PROMO = { code: 'EID10', nameEn: 'Eid offer', nameBn: 'ঈদ অফার', discountPoysha: 25000 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
  vi.mocked(getPaymentMethods).mockResolvedValue(['CASH_ON_DELIVERY', 'BKASH']);
});

describe('previewPromoAction', () => {
  it('checks the code, upper-cased, against the page amounts', async () => {
    vi.mocked(checkoutApi.previewPromotion).mockResolvedValue({ ok: true, data: PROMO });

    const state = await previewPromoAction(
      { status: 'idle' },
      form({ code: ' eid10 ', subtotalPoysha: '250000', deliveryFeePoysha: '6000' }),
    );

    expect(state).toEqual({ status: 'applied', promo: PROMO });
    expect(checkoutApi.previewPromotion).toHaveBeenCalledWith(CALLER, 'EID10', 250000, 6000);
  });

  it('treats tampered amounts as zero rather than sending them on', async () => {
    vi.mocked(checkoutApi.previewPromotion).mockResolvedValue({ ok: true, data: PROMO });
    await previewPromoAction(
      { status: 'idle' },
      form({ code: 'EID10', subtotalPoysha: '-5', deliveryFeePoysha: 'abc' }),
    );
    expect(checkoutApi.previewPromotion).toHaveBeenCalledWith(CALLER, 'EID10', 0, 0);
  });

  it('says why a code was refused', async () => {
    vi.mocked(checkoutApi.previewPromotion).mockResolvedValue({
      ok: false,
      status: 422,
      message: 'Your basket does not meet the minimum for this promo code.',
    });
    await expect(previewPromoAction({ status: 'idle' }, form({ code: 'BIG' }))).resolves.toEqual({
      status: 'error',
      error: 'promoMinimum',
    });
  });

  it('refuses an empty code without calling the API', async () => {
    await expect(previewPromoAction({ status: 'idle' }, form({ code: '  ' }))).resolves.toEqual({
      status: 'error',
      error: 'promoInvalid',
    });
    expect(checkoutApi.previewPromotion).not.toHaveBeenCalled();
  });

  it('needs a signed-in shopper', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(previewPromoAction({ status: 'idle' }, form({ code: 'EID10' }))).resolves.toEqual({
      status: 'error',
      error: 'signedOut',
    });
  });

  it('removes an applied code', async () => {
    await expect(
      previewPromoAction({ status: 'applied', promo: PROMO }, form({ intent: 'remove' })),
    ).resolves.toEqual({ status: 'idle' });
    expect(checkoutApi.previewPromotion).not.toHaveBeenCalled();
  });
});

describe('placeOrderAction', () => {
  it('places a cash-on-delivery order with the chosen window, code and note, then opens it', async () => {
    vi.mocked(checkoutApi.place).mockResolvedValue({ ok: true, data: order() });

    await expect(
      placeOrderAction(
        { status: 'idle' },
        form({
          addressId: 'addr-1',
          slot: 'slot-morning|2026-11-20',
          promotionCode: 'EID10',
          customerNote: '  Ring twice  ',
          acceptPriceChanges: 'on',
        }),
      ),
    ).rejects.toBe(REDIRECTED);

    expect(checkoutApi.place).toHaveBeenCalledWith(CALLER, {
      addressId: 'addr-1',
      paymentMethod: 'CASH_ON_DELIVERY',
      deliverySlotId: 'slot-morning',
      deliveryDate: '2026-11-20',
      promotionCode: 'EID10',
      customerNote: 'Ring twice',
      acceptPriceChanges: true,
    });
    expect(redirect).toHaveBeenCalledWith({ href: '/checkout/placed/order-1', locale: 'bn' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('sends only what was chosen', async () => {
    vi.mocked(checkoutApi.place).mockResolvedValue({ ok: true, data: order() });
    await expect(
      placeOrderAction({ status: 'idle' }, form({ addressId: 'addr-1', slot: '' })),
    ).rejects.toBe(REDIRECTED);
    expect(checkoutApi.place).toHaveBeenCalledWith(CALLER, {
      addressId: 'addr-1',
      paymentMethod: 'CASH_ON_DELIVERY',
    });
  });

  it('cuts a note to the length the API keeps', async () => {
    vi.mocked(checkoutApi.place).mockResolvedValue({ ok: true, data: order() });
    await expect(
      placeOrderAction({ status: 'idle' }, form({ addressId: 'a', customerNote: 'x'.repeat(600) })),
    ).rejects.toBe(REDIRECTED);
    expect(vi.mocked(checkoutApi.place).mock.calls[0]?.[1].customerNote).toHaveLength(500);
  });

  it('redraws the page and says what to do when the order is refused', async () => {
    vi.mocked(checkoutApi.place).mockResolvedValue({
      ok: false,
      status: 409,
      message:
        'Some prices have changed since you added these items. Review your basket and try again.',
    });

    const state = await placeOrderAction({ status: 'idle' }, form({ addressId: 'addr-1' }));

    expect(state).toMatchObject({ status: 'error', error: 'pricesChanged' });
    expect(refresh).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('needs an address and a signed-in shopper before calling the API', async () => {
    await expect(placeOrderAction({ status: 'idle' }, form({}))).resolves.toMatchObject({
      error: 'noAddress',
    });
    vi.mocked(accountCaller).mockResolvedValue(null);
    await expect(
      placeOrderAction({ status: 'idle' }, form({ addressId: 'addr-1' })),
    ).resolves.toMatchObject({ error: 'signedOut' });
    expect(checkoutApi.place).not.toHaveBeenCalled();
  });

  describe('paying with bKash', () => {
    const BKASH_ORDER = order({ id: 'order-7', paymentMethod: 'BKASH' });

    it('places a bKash order, then sends the browser to bKash to pay it', async () => {
      vi.mocked(checkoutApi.place).mockResolvedValue({ ok: true, data: BKASH_ORDER });
      vi.mocked(paymentsApi.startBkash).mockResolvedValue({
        ok: true,
        data: { redirectUrl: 'https://pay.bkash.example/checkout/1', expiresInSeconds: 900 },
      });

      await expect(
        placeOrderAction({ status: 'idle' }, form({ addressId: 'addr-1', paymentMethod: 'BKASH' })),
      ).rejects.toBe(AWAY);

      expect(checkoutApi.place).toHaveBeenCalledWith(CALLER, {
        addressId: 'addr-1',
        paymentMethod: 'BKASH',
      });
      expect(paymentsApi.startBkash).toHaveBeenCalledWith(CALLER, 'order-7');
      expect(redirectAway).toHaveBeenCalledWith('https://pay.bkash.example/checkout/1');
      expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    });

    it('opens the placed order with the reason when the payment cannot start', async () => {
      vi.mocked(checkoutApi.place).mockResolvedValue({ ok: true, data: BKASH_ORDER });
      vi.mocked(paymentsApi.startBkash).mockResolvedValue({
        ok: false,
        status: 502,
        message: 'bKash could not start the payment. Please try again.',
      });

      await expect(
        placeOrderAction({ status: 'idle' }, form({ addressId: 'a', paymentMethod: 'BKASH' })),
      ).rejects.toBe(REDIRECTED);

      expect(redirect).toHaveBeenCalledWith({
        href: { pathname: '/checkout/placed/order-7', query: { payment: 'gateway' } },
        locale: 'bn',
      });
      expect(redirectAway).not.toHaveBeenCalled();
    });

    it('never follows a payment address that is not a web page', async () => {
      vi.mocked(checkoutApi.place).mockResolvedValue({ ok: true, data: BKASH_ORDER });
      vi.mocked(paymentsApi.startBkash).mockResolvedValue({
        ok: true,
        data: { redirectUrl: 'javascript:alert(1)', expiresInSeconds: 900 },
      });

      await expect(
        placeOrderAction({ status: 'idle' }, form({ addressId: 'a', paymentMethod: 'BKASH' })),
      ).rejects.toBe(REDIRECTED);

      expect(redirectAway).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith({
        href: { pathname: '/checkout/placed/order-7', query: { payment: 'gateway' } },
        locale: 'bn',
      });
    });

    it('refuses bKash when the shop does not offer it, without placing the order', async () => {
      vi.mocked(getPaymentMethods).mockResolvedValue(['CASH_ON_DELIVERY']);

      await expect(
        placeOrderAction({ status: 'idle' }, form({ addressId: 'a', paymentMethod: 'BKASH' })),
      ).resolves.toMatchObject({ status: 'error', error: 'bkashUnavailable' });
      expect(checkoutApi.place).not.toHaveBeenCalled();
    });

    it('treats an unknown method as cash on delivery', async () => {
      vi.mocked(checkoutApi.place).mockResolvedValue({ ok: true, data: order() });
      await expect(
        placeOrderAction({ status: 'idle' }, form({ addressId: 'a', paymentMethod: 'NAGAD' })),
      ).rejects.toBe(REDIRECTED);
      expect(vi.mocked(checkoutApi.place).mock.calls[0]?.[1].paymentMethod).toBe(
        'CASH_ON_DELIVERY',
      );
      expect(paymentsApi.startBkash).not.toHaveBeenCalled();
    });
  });
});

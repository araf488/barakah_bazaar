import { Banknote, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PaymentMethod } from '../../lib/checkout/api';
import { CASH_ON_DELIVERY } from '../../lib/payments/rules';
import { PLACE_ORDER_FORM_ID } from './formId';

/** A phone for the mobile wallet, banknotes for cash: what each method asks the shopper to hold. */
const ICON = { CASH_ON_DELIVERY: Banknote, BKASH: Smartphone } as const;
const LABEL_KEY = { CASH_ON_DELIVERY: 'cod', BKASH: 'bkash' } as const;
const HINT_KEY = { CASH_ON_DELIVERY: 'codHint', BKASH: 'bkashHint' } as const;

/**
 * How the shopper pays. With cash on delivery the only method on offer there is nothing to choose,
 * so it is stated; otherwise each method is a radio joined to the place-order form, cash first.
 */
export function PaymentChooser({ methods }: { methods: readonly PaymentMethod[] }) {
  const t = useTranslations('checkout');
  if (methods.length <= 1) {
    return (
      <p className="flex items-center gap-3 rounded-2xl border-2 border-brand bg-white p-4">
        <Banknote aria-hidden="true" size={22} className="shrink-0 text-brand" />
        <span>
          <span className="block font-semibold text-ink">{t('cod')}</span>
          <span className="block text-sm text-subtle">{t('codHint')}</span>
        </span>
      </p>
    );
  }
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{t('methodLabel')}</legend>
      {methods.map((method) => {
        const Icon = ICON[method];
        return (
          <label
            key={method}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border bg-white p-4 transition hover:border-brand/50 has-[:checked]:border-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30"
          >
            <input
              type="radio"
              name="paymentMethod"
              value={method}
              form={PLACE_ORDER_FORM_ID}
              defaultChecked={method === CASH_ON_DELIVERY}
              className="size-5 shrink-0 accent-brand"
            />
            <Icon aria-hidden="true" size={22} className="shrink-0 text-brand" />
            <span>
              <span className="block font-semibold text-ink">{t(LABEL_KEY[method])}</span>
              <span className="block text-sm text-subtle">{t(HINT_KEY[method])}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

'use client';

import { formatCount, formatPoysha, pickLocalized } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';

import type { CartView } from '../../lib/cart/view';
import {
  type PlaceOrderState,
  placeOrderAction,
  type PromoState,
  previewPromoAction,
} from '../../lib/checkout/actions';
import type { QuoteOutcome } from '../../lib/checkout/delivery';
import type { PaymentMethod } from '../../lib/checkout/api';
import type { CheckoutErrorKey } from '../../lib/checkout/errors';
import { totalOf } from '../../lib/checkout/rules';
import { BKASH, CASH_ON_DELIVERY, parsePaymentMethod } from '../../lib/payments/rules';
import { PLACE_ORDER_FORM_ID } from './formId';
import { PromoBox } from './PromoBox';
import { submitKeepingChoices } from './submitKeepingChoices';

const PROMO_IDLE: PromoState = { status: 'idle' };
const PLACE_IDLE: PlaceOrderState = { status: 'idle' };
const MINUS = '−';

function SummaryLines({ cart }: { cart: CartView }) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  return (
    <ul className="divide-y divide-border">
      {cart.lines.map((line) => (
        <li key={line.key} className="flex justify-between gap-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block font-medium text-ink">
              {pickLocalized({ nameEn: line.nameEn, nameBn: line.nameBn }, locale).text}
            </span>
            <span className="text-subtle">
              {t('lineQuantity', {
                quantity: formatCount(line.quantity, locale),
                size: line.variantLabel,
              })}
            </span>
          </span>
          <span className="shrink-0 text-ink">
            {line.lineTotalPoysha === null ? null : formatPoysha(line.lineTotalPoysha, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface TotalsProps {
  subtotalPoysha: number;
  quote: QuoteOutcome | null;
  promo: PromoState;
  totalPoysha: number;
}

function Totals({ subtotalPoysha, quote, promo, totalPoysha }: TotalsProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  let delivery = t('deliveryUnknown');
  if (quote?.ok) {
    delivery = quote.quote.isFree ? t('deliveryFree') : formatPoysha(quote.quote.feePoysha, locale);
  }
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-subtle">{t('subtotal')}</dt>
        <dd className="text-ink">{formatPoysha(subtotalPoysha, locale)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-subtle">{t('delivery')}</dt>
        <dd className="text-ink">{delivery}</dd>
      </div>
      {promo.status === 'applied' ? (
        <div className="flex justify-between">
          <dt className="text-subtle">{t('discount', { code: promo.promo.code })}</dt>
          <dd className="text-brand">
            {MINUS}
            {formatPoysha(promo.promo.discountPoysha, locale)}
          </dd>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-border pt-2">
        <dt className="font-semibold text-ink">{t('total')}</dt>
        <dd className="font-display text-xl font-bold text-ink">
          {formatPoysha(totalPoysha, locale)}
        </dd>
      </div>
    </dl>
  );
}

interface PlaceButtonProps {
  blocked: boolean;
  pending: boolean;
  describedBy: string;
  method: PaymentMethod;
}

function PlaceButton({ blocked, pending, describedBy, method }: PlaceButtonProps) {
  const t = useTranslations('checkout');
  return (
    <button
      type="submit"
      disabled={blocked || pending}
      aria-describedby={describedBy}
      className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-6 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? t('placing') : t(method === BKASH ? 'placeBkash' : 'place')}
    </button>
  );
}

export interface OrderSummaryProps {
  cart: CartView;
  addressId: string | null;
  quote: QuoteOutcome | null;
  /** Why the order cannot be placed as the page stands (no hub, stock); `null` when it can. */
  blocker: CheckoutErrorKey | null;
}

/**
 * The payment method chosen on the page. The radios sit in the page's payment step, joined to the
 * place-order form by its id, so the summary listens for their changes on the document.
 */
const useChosenMethod = (): PaymentMethod => {
  const [method, setMethod] = useState<PaymentMethod>(CASH_ON_DELIVERY);
  useEffect(() => {
    const onChange = (event: Event) => {
      const field = event.target;
      if (
        field instanceof HTMLInputElement &&
        field.name === 'paymentMethod' &&
        field.form?.id === PLACE_ORDER_FORM_ID
      ) {
        setMethod(parsePaymentMethod(field.value));
      }
    };
    document.addEventListener('change', onChange);
    return () => document.removeEventListener('change', onChange);
  }, []);
  return method;
};

/**
 * The summary column: lines, promo code, totals and the place-order form. The totals are what
 * the shopper should expect; the API prices the order again when it is placed.
 */
export function OrderSummary({ cart, addressId, quote, blocker }: OrderSummaryProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const [promo, promoAction, checkingPromo] = useActionState(previewPromoAction, PROMO_IDLE);
  const [placed, placeAction, placing] = useActionState(placeOrderAction, PLACE_IDLE);
  const hintId = useId();
  const method = useChosenMethod();
  const feePoysha = quote?.ok ? quote.quote.feePoysha : 0;
  const discountPoysha = promo.status === 'applied' ? promo.promo.discountPoysha : 0;
  const totalPoysha = totalOf(cart.subtotalPoysha, feePoysha, discountPoysha);
  const shortfall = quote?.ok ? quote.quote.freeDeliveryShortfallPoysha : 0;
  const problem = placed.status === 'error' ? placed.error : blocker;

  return (
    <section
      aria-labelledby="summary-title"
      className="space-y-4 rounded-2xl border border-border bg-white p-5 lg:sticky lg:top-24"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="summary-title" className="font-display text-xl font-semibold text-ink">
          {t('summaryTitle')}
        </h2>
        <span className="text-sm text-subtle">{t('items', { count: cart.itemCount })}</span>
      </div>
      <SummaryLines cart={cart} />
      <PromoBox
        state={promo}
        action={promoAction}
        pending={checkingPromo}
        subtotalPoysha={cart.subtotalPoysha}
        deliveryFeePoysha={feePoysha}
      />
      <Totals
        subtotalPoysha={cart.subtotalPoysha}
        quote={quote}
        promo={promo}
        totalPoysha={totalPoysha}
      />
      {shortfall > 0 ? (
        <p className="rounded-xl bg-gold/10 px-3 py-2 text-sm text-ink">
          {t('freeDeliveryShortfall', { amount: formatPoysha(shortfall, locale) })}
        </p>
      ) : null}
      <form
        id={PLACE_ORDER_FORM_ID}
        action={placeAction}
        onSubmit={(event) => submitKeepingChoices(event, placeAction)}
        noValidate
        className="space-y-3"
      >
        <input type="hidden" name="addressId" value={addressId ?? ''} />
        {promo.status === 'applied' ? (
          <input type="hidden" name="promotionCode" value={promo.promo.code} />
        ) : null}
        {cart.hasPriceChanges ? (
          <div className="space-y-2 rounded-xl bg-gold/10 px-3 py-2 text-sm text-ink">
            <p>{t('priceNotice')}</p>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
              <input type="checkbox" name="acceptPriceChanges" className="size-5 accent-brand" />
              {t('acceptPrices')}
            </label>
          </div>
        ) : null}
        {problem ? (
          <p
            key={placed.status === 'error' ? placed.at : problem}
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          >
            {t(`errors.${problem}`)}
          </p>
        ) : null}
        <PlaceButton
          blocked={blocker !== null || !addressId}
          pending={placing}
          describedBy={hintId}
          method={method}
        />
        <p id={hintId} className="text-center text-xs text-subtle">
          {t(method === BKASH ? 'placeHintBkash' : 'placeHint', {
            total: formatPoysha(totalPoysha, locale),
          })}
        </p>
      </form>
    </section>
  );
}

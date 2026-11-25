'use client';

import { formatPoysha } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { type OrderPaymentState, orderPaymentAction } from '../../lib/payments/actions';
import type { PaymentErrorKey } from '../../lib/payments/errors';
import { SWITCH_TO_COD_INTENT } from '../../lib/payments/rules';

const IDLE: OrderPaymentState = { status: 'idle' };

/** The refusal to show: this page's own attempt first, else the one it opened with. */
const errorOf = (
  state: OrderPaymentState,
  initial: PaymentErrorKey | null,
): PaymentErrorKey | null => {
  if (state.status === 'error') {
    return state.error;
  }
  return state.status === 'idle' ? initial : null;
};

function SubmitButton({
  label,
  busyLabel,
  primary,
}: {
  label: string;
  busyLabel: string;
  primary: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        primary
          ? 'inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-6 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'
          : 'inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'
      }
    >
      {pending ? busyLabel : label}
    </button>
  );
}

export interface BkashPayPanelProps {
  orderId: string;
  totalPoysha: number;
  /** True while the order is an unpaid bKash order the shop has not confirmed. */
  awaiting: boolean;
  /** Why the payment could not start before this page opened (placing the order, say). */
  initialError?: PaymentErrorKey | null;
}

/**
 * Paying an order that waits for bKash: a new attempt on bKash's own page, or moving it to cash
 * on delivery. The page redraws after either; once the order no longer waits this says what
 * happened (switched, or why not) instead of offering the buttons again.
 */
export function BkashPayPanel({
  orderId,
  totalPoysha,
  awaiting,
  initialError = null,
}: BkashPayPanelProps) {
  const t = useTranslations('payment');
  const locale = useLocale();
  const [state, action] = useActionState(orderPaymentAction, IDLE);
  const error = errorOf(state, initialError);
  const refusal = error ? (
    <p
      key={state.status === 'error' ? state.at : error}
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
    >
      {t(`errors.${error}`)}
    </p>
  ) : null;

  if (!awaiting) {
    return state.status === 'switched' ? (
      <p role="status" className="rounded-xl bg-warm px-4 py-3 text-sm font-medium text-ink">
        {t('pay.switched')}
      </p>
    ) : (
      refusal
    );
  }

  return (
    <section
      aria-labelledby="bkash-pay-title"
      className="space-y-3 rounded-2xl border-2 border-gold/40 bg-white p-5"
    >
      <h2 id="bkash-pay-title" className="font-display text-xl font-semibold text-ink">
        {t('pay.title')}
      </h2>
      <p className="text-sm text-subtle">{t('pay.body')}</p>
      {refusal}
      <form action={action}>
        <input type="hidden" name="orderId" value={orderId} />
        <SubmitButton
          label={t('pay.button', { total: formatPoysha(totalPoysha, locale) })}
          busyLabel={t('pay.paying')}
          primary
        />
      </form>
      <form action={action}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="intent" value={SWITCH_TO_COD_INTENT} />
        <SubmitButton label={t('pay.switch')} busyLabel={t('pay.switching')} primary={false} />
      </form>
    </section>
  );
}

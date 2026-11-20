'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useRef, useState } from 'react';

import { type CancelOrderState, cancelOrderAction } from '../../lib/orders/actions';
import { MAX_CANCEL_REASON_LENGTH } from '../../lib/orders/rules';
import { submitKeepingChoices } from '../checkout/submitKeepingChoices';

const IDLE: CancelOrderState = { status: 'idle' };

export interface CancelOrderProps {
  orderId: string;
  orderNumber: string;
  /** From the API: true while the order is placed or confirmed. */
  canCancel: boolean;
}

/**
 * Cancelling an order, behind a confirmation step so a stray tap cannot do it. After a
 * successful cancel the page redraws with `canCancel` false and this says it is done; after a
 * refusal the reason typed stays in its field.
 */
export function CancelOrder({ orderId, orderNumber, canCancel }: CancelOrderProps) {
  const t = useTranslations('orders.cancel');
  const [state, action, pending] = useActionState(cancelOrderAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const reasonId = useId();

  const refusal =
    state.status === 'error' ? (
      <p
        key={state.at}
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
      >
        {t(`errors.${state.error}`)}
      </p>
    ) : null;

  // The page redraws after every attempt; once the order can no longer be cancelled, say what
  // happened (done, or why not) instead of offering the button again.
  if (!canCancel) {
    return state.status === 'cancelled' ? (
      <p role="status" className="rounded-xl bg-warm px-4 py-3 text-sm font-medium text-ink">
        {t('done')}
      </p>
    ) : (
      refusal
    );
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <button
          ref={openRef}
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex min-h-11 items-center rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-800 transition hover:bg-red-50 active:scale-[0.98]"
        >
          {t('open')}
        </button>
        <p className="text-xs text-subtle">{t('hint')}</p>
      </div>
    );
  }

  const keepOrder = () => {
    setConfirming(false);
    // The open button is drawn again on the next render; give it focus back once it exists.
    requestAnimationFrame(() => openRef.current?.focus());
  };

  return (
    <form
      action={action}
      onSubmit={(event) => submitKeepingChoices(event, action)}
      aria-labelledby={titleId}
      className="space-y-3 rounded-2xl border border-red-200 bg-white p-4"
    >
      <h3 id={titleId} className="font-semibold text-ink">
        {t('title', { number: orderNumber })}
      </h3>
      <input type="hidden" name="orderId" value={orderId} />
      <div className="space-y-1">
        <label htmlFor={reasonId} className="block text-sm font-medium text-ink">
          {t('reasonLabel')}
        </label>
        <textarea
          id={reasonId}
          name="reason"
          rows={2}
          maxLength={MAX_CANCEL_REASON_LENGTH}
          autoFocus
          className="w-full rounded-xl border border-border px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        />
      </div>
      {refusal}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t('cancelling') : t('confirm')}
        </button>
        <button
          type="button"
          onClick={keepOrder}
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('keep')}
        </button>
      </div>
    </form>
  );
}

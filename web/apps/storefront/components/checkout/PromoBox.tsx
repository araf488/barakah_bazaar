'use client';

import { formatPoysha, pickLocalized } from '@barakah/ui';
import { Tag, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';

import type { PromoState } from '../../lib/checkout/actions';
import { MAX_PROMO_CODE_LENGTH } from '../../lib/checkout/rules';
import { submitKeepingChoices } from './submitKeepingChoices';

function ApplyButton({ pending }: { pending: boolean }) {
  const t = useTranslations('checkout');
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 shrink-0 items-center rounded-xl border-2 border-brand px-4 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white active:scale-95 disabled:opacity-70"
    >
      {pending ? t('promoApplying') : t('promoApply')}
    </button>
  );
}

interface PromoBoxProps {
  state: PromoState;
  action: (form: FormData) => void;
  /** The code is being checked. */
  pending: boolean;
  subtotalPoysha: number;
  deliveryFeePoysha: number;
}

/**
 * A promo code field with its own form (forms cannot nest, and the code is checked before the
 * order is placed). Once applied it shows the saving and a remove button instead.
 */
export function PromoBox({
  state,
  action,
  pending,
  subtotalPoysha,
  deliveryFeePoysha,
}: PromoBoxProps) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const inputId = useId();
  const errorId = useId();

  if (state.status === 'applied') {
    const { promo } = state;
    const name = pickLocalized(
      { nameEn: promo.nameEn, nameBn: promo.nameBn ?? promo.nameEn },
      locale,
    ).text;
    return (
      <form action={action} className="flex items-center gap-2 rounded-xl bg-brand/5 px-3 py-1">
        <Tag aria-hidden="true" size={16} className="shrink-0 text-brand" />
        <p className="min-w-0 flex-1 text-sm text-ink">
          {t('promoApplied', {
            code: promo.code,
            amount: formatPoysha(promo.discountPoysha, locale),
          })}
          <span className="block truncate text-xs text-subtle">{name}</span>
        </p>
        <input type="hidden" name="intent" value="remove" />
        <button
          type="submit"
          aria-label={t('promoRemove', { code: promo.code })}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-subtle transition hover:bg-warm hover:text-ink active:scale-95"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </form>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(event) => submitKeepingChoices(event, action)}
      noValidate
      className="space-y-1"
    >
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {t('promoLabel')}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={MAX_PROMO_CODE_LENGTH}
          aria-invalid={state.status === 'error'}
          aria-describedby={state.status === 'error' ? errorId : undefined}
          className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-white px-3 text-sm uppercase text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-red-400"
        />
        <input type="hidden" name="subtotalPoysha" value={subtotalPoysha} />
        <input type="hidden" name="deliveryFeePoysha" value={deliveryFeePoysha} />
        <ApplyButton pending={pending} />
      </div>
      {state.status === 'error' ? (
        <p id={errorId} role="alert" className="text-sm text-red-800">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  );
}

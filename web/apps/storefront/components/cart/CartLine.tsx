'use client';

import { formatCount, formatPoysha, pickLocalized } from '@barakah/ui';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { setQuantityAction } from '../../lib/cart/actions';
import { MAX_QUANTITY_PER_LINE } from '../../lib/cart/guestCart';
import type { CartLineView } from '../../lib/cart/view';

const THUMB_SIZE = 64;

function StepButton({ label, children }: { label: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      disabled={pending}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-ink transition hover:bg-white active:scale-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** A form that sets this line to `quantity`; the API's PATCH is absolute, so the form is too. */
function QuantityForm({
  lineKey,
  quantity,
  label,
  children,
}: {
  lineKey: string;
  quantity: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <form action={setQuantityAction}>
      <input type="hidden" name="key" value={lineKey} />
      <input type="hidden" name="quantity" value={quantity} />
      <StepButton label={label}>{children}</StepButton>
    </form>
  );
}

/** Image, name, size, price, a quantity stepper and remove; warnings when price or stock moved. */
export function CartLine({ line }: { line: CartLineView }) {
  const t = useTranslations('cart');
  const locale = useLocale();
  const name = pickLocalized({ nameEn: line.nameEn, nameBn: line.nameBn }, locale).text;

  return (
    <li className="flex gap-4 border-b border-border py-4">
      <span className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-warm">
        {line.imageUrl ? (
          <img
            src={line.imageUrl}
            alt=""
            width={THUMB_SIZE}
            height={THUMB_SIZE}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{name}</p>
        <p className="text-xs text-subtle">
          {line.variantLabel}
          {line.unitPricePoysha === null
            ? ''
            : ` · ${t('each', { price: formatPoysha(line.unitPricePoysha, locale) })}`}
        </p>
        {line.unavailable ? (
          <p className="mt-1 text-xs font-semibold text-red-700">{t('unavailableLine')}</p>
        ) : null}
        {line.priceChanged ? (
          <p className="mt-1 text-xs font-semibold text-ink">{t('priceChanged')}</p>
        ) : null}
        {line.onlyLeft !== null ? (
          <p className="mt-1 text-xs font-semibold text-red-700">
            {t('onlyLeft', { count: line.onlyLeft })}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          {line.unavailable ? (
            <span />
          ) : (
            <div
              className="flex items-center rounded-xl border border-border bg-warm"
              role="group"
              aria-label={t('quantity')}
            >
              <QuantityForm
                lineKey={line.key}
                quantity={line.quantity - 1}
                label={t('decrease', { name })}
              >
                <Minus aria-hidden="true" size={14} />
              </QuantityForm>
              <span className="w-8 text-center text-sm font-semibold" aria-live="polite">
                {formatCount(line.quantity, locale)}
              </span>
              {line.quantity < MAX_QUANTITY_PER_LINE ? (
                <QuantityForm
                  lineKey={line.key}
                  quantity={line.quantity + 1}
                  label={t('increase', { name })}
                >
                  <Plus aria-hidden="true" size={14} />
                </QuantityForm>
              ) : null}
            </div>
          )}
          <span className="text-sm font-bold text-brand">
            {line.lineTotalPoysha === null ? '' : formatPoysha(line.lineTotalPoysha, locale)}
          </span>
          <QuantityForm lineKey={line.key} quantity={0} label={t('remove', { name })}>
            <Trash2 aria-hidden="true" size={16} className="text-subtle" />
          </QuantityForm>
        </div>
      </div>
    </li>
  );
}

'use client';

import { formatPoysha, LocalizedName } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ProductVariant } from '../../lib/api/catalog';
import { defaultVariant, savingPercent } from '../../lib/variants';
import { AddToCart } from './AddToCart';

function Price({ variant }: { variant: ProductVariant }) {
  const t = useTranslations('pdp');
  const saving = savingPercent(variant);

  return (
    <div
      aria-live="polite"
      className="flex flex-wrap items-end gap-x-3 gap-y-1 border-y border-border py-4"
    >
      <span className="font-display text-4xl font-bold text-brand">{variant.priceFormatted}</span>
      <span className="mb-1 text-sm text-subtle">{t('perUnit', { unit: variant.unitLabel })}</span>
      {saving !== null && variant.compareAtPricePoysha ? (
        <>
          <s className="mb-1 text-lg text-subtle">
            <span className="sr-only">
              {t('wasPrice', { price: formatPoysha(variant.compareAtPricePoysha) })}
            </span>
            <span aria-hidden="true">{formatPoysha(variant.compareAtPricePoysha)}</span>
          </s>
          <span className="mb-1.5 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white">
            {t('saving', { percent: saving })}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * Size choice and the price it sets. Sizes are native radio inputs, so arrow keys, focus and
 * screen readers behave as for any radio group. Add-to-cart sends the selected size.
 */
export function BuyBox({ slug, variants }: { slug: string; variants: ProductVariant[] }) {
  const t = useTranslations('pdp');
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState(defaultVariant(variants)?.id);
  const selected = variants.find((variant) => variant.id === selectedId);

  if (!selected) {
    return null;
  }

  return (
    <div className="space-y-6">
      <Price variant={selected} />
      {variants.length > 1 ? (
        <fieldset>
          <legend className="mb-2.5 text-sm font-semibold text-ink">{t('chooseVariant')}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => (
              <label
                key={variant.id}
                className="flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border border-border bg-white px-5 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-95 has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand"
              >
                <input
                  type="radio"
                  name="variant"
                  value={variant.id}
                  checked={variant.id === selected.id}
                  onChange={() => setSelectedId(variant.id)}
                  className="sr-only"
                />
                <span>{variant.unitLabel}</span>
                <span className="mt-0.5 text-[11px] font-normal opacity-80">
                  {variant.priceFormatted}
                </span>
                <span className="sr-only">
                  <LocalizedName entity={variant} locale={locale} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <AddToCart slug={slug} variantId={selected.id} />
    </div>
  );
}

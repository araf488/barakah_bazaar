import { formatCount, formatPoysha, pickLocalized } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import type { Order } from '../../lib/checkout/api';

const MINUS = '−';

/** What was ordered, at the prices frozen when it was placed. */
export function OrderItems({ items }: { items: Order['items'] }) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex justify-between gap-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block font-medium text-ink">
              {
                pickLocalized({ nameEn: item.productNameEn, nameBn: item.productNameBn }, locale)
                  .text
              }
            </span>
            <span className="text-subtle">
              {t('lineQuantity', {
                quantity: formatCount(item.quantity, locale),
                size: item.variantNameEn,
              })}
            </span>
          </span>
          <span className="shrink-0 text-ink">{formatPoysha(item.lineTotalPoysha, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

type Amounts = Pick<
  Order,
  'subtotalPoysha' | 'deliveryFeePoysha' | 'discountPoysha' | 'totalPoysha'
>;

/** Subtotal, delivery, discount (when there was one) and total, as the API charged them. */
export function OrderTotals({ order }: { order: Amounts }) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-subtle">{t('subtotal')}</dt>
        <dd className="text-ink">{formatPoysha(order.subtotalPoysha, locale)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-subtle">{t('delivery')}</dt>
        <dd className="text-ink">
          {order.deliveryFeePoysha === 0
            ? t('deliveryFree')
            : formatPoysha(order.deliveryFeePoysha, locale)}
        </dd>
      </div>
      {order.discountPoysha > 0 ? (
        <div className="flex justify-between">
          <dt className="text-subtle">{t('discountTotal')}</dt>
          <dd className="text-brand">
            {MINUS}
            {formatPoysha(order.discountPoysha, locale)}
          </dd>
        </div>
      ) : null}
      <div className="flex justify-between">
        <dt className="font-semibold text-ink">{t('total')}</dt>
        <dd className="font-display text-lg font-bold text-ink">
          {formatPoysha(order.totalPoysha, locale)}
        </dd>
      </div>
    </dl>
  );
}

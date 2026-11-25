import { formatCount, formatPoysha, pickLocalized } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { Order } from '../../lib/checkout/api';
import { formatOrderDate } from '../../lib/orders/format';
import { orderPath } from '../../lib/routes';
import { OrderStatusBadge } from './OrderStatusBadge';

/** How many product names a card lists before "+N more". */
export const CARD_ITEM_NAMES = 2;

/**
 * One order in the list: number, status, date, what is in it and the total. The whole card opens
 * the order, where its history and the cancel button live (the list carries no history).
 */
export function OrderCard({ order }: { order: Order }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const names = order.items
    .slice(0, CARD_ITEM_NAMES)
    .map(
      (item) =>
        pickLocalized({ nameEn: item.productNameEn, nameBn: item.productNameBn }, locale).text,
    )
    .join(', ');
  const hidden = order.items.length - CARD_ITEM_NAMES;
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Link
      href={orderPath(order.id)}
      className="block rounded-2xl border border-border bg-white p-5 transition hover:border-brand hover:shadow-md hover:shadow-brand/5 focus-visible:border-brand"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span dir="ltr" className="font-semibold text-ink">
          {order.orderNumber}
        </span>
        <OrderStatusBadge status={order.status} />
      </span>
      <span className="mt-1 block text-xs text-subtle">
        {t('placedOn', { date: formatOrderDate(order.placedAt, locale) })} ·{' '}
        {t('items', { count: itemCount })}
      </span>
      <span className="mt-3 block truncate text-sm text-ink">
        {names}
        {hidden > 0 ? (
          <span className="text-subtle"> {t('more', { count: formatCount(hidden, locale) })}</span>
        ) : null}
      </span>
      <span className="mt-2 block font-display text-lg font-bold text-ink">
        {formatPoysha(order.totalPoysha, locale)}
      </span>
    </Link>
  );
}

import { useTranslations } from 'next-intl';

import type { OrderStatus } from '../../lib/checkout/api';

/**
 * Tone per status: neutral while the shop works on it, gold once it is on the road (the one
 * moment a shopper waits at the door), brand green when it arrived, red when it was called off.
 * The label always carries the meaning; the colour only helps a scan down the list.
 */
const TONE: Record<OrderStatus, { chip: string; dot: string }> = {
  PLACED: { chip: 'bg-warm text-ink', dot: 'bg-subtle' },
  CONFIRMED: { chip: 'bg-warm text-ink', dot: 'bg-subtle' },
  PICKING: { chip: 'bg-warm text-ink', dot: 'bg-subtle' },
  DISPATCHED: { chip: 'bg-gold/15 text-ink', dot: 'bg-gold' },
  DELIVERED: { chip: 'bg-brand/10 text-brand', dot: 'bg-brand' },
  CANCELLED: { chip: 'bg-red-50 text-red-800', dot: 'bg-red-600' },
  REFUNDED: { chip: 'bg-red-50 text-red-800', dot: 'bg-red-600' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('orders.status');
  const tone = TONE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.chip}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${tone.dot}`} />
      {t(status)}
    </span>
  );
}

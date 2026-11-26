import { ChevronLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CancelOrder } from '../../../../../components/orders/CancelOrder';
import { OrderItems, OrderTotals } from '../../../../../components/orders/OrderContents';
import { OrderStatusBadge } from '../../../../../components/orders/OrderStatusBadge';
import { OrderTimeline } from '../../../../../components/orders/OrderTimeline';
import { BkashPayPanel } from '../../../../../components/payments/BkashPayPanel';
import type { StorefrontLocale } from '../../../../../i18n/messages';
import { Link, redirect } from '../../../../../i18n/navigation';
import { placeLine } from '../../../../../lib/account/format';
import { getCurrentUser } from '../../../../../lib/auth/session';
import type { Order } from '../../../../../lib/checkout/api';
import { getOrder } from '../../../../../lib/checkout/getOrder';
import { formatOrderDate } from '../../../../../lib/orders/format';
import { awaitsBkashPayment } from '../../../../../lib/payments/rules';
import { LIVE_PAGES, orderPath, ROUTES } from '../../../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('orders.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

const CARD = 'rounded-2xl border border-border bg-white p-5';
const CARD_HEADING = 'mb-2 text-sm font-semibold text-subtle';

/** Where it goes, who takes it, and the note left for the rider. */
async function DeliveryCard({ order }: { order: Order }) {
  const t = await getTranslations('orders.detail');
  return (
    <section aria-labelledby="deliver-title" className={CARD}>
      <h2 id="deliver-title" className={CARD_HEADING}>
        {t('deliverTo')}
      </h2>
      <p className="text-sm font-medium text-ink">
        {order.recipientName} · <span dir="ltr">{order.phone}</span>
      </p>
      <p className="mt-1 text-sm text-subtle">{placeLine(order)}</p>
      {order.customerNote ? (
        <p className="mt-3 border-t border-border pt-3 text-sm text-subtle">
          <span className="font-medium text-ink">{t('note')}: </span>
          {order.customerNote}
        </p>
      ) : null}
    </section>
  );
}

async function PaymentCard({ order }: { order: Order }) {
  const t = await getTranslations('orders.detail');
  return (
    <section aria-labelledby="payment-title" className={CARD}>
      <h2 id="payment-title" className={CARD_HEADING}>
        {t('payment')}
      </h2>
      <p className="text-sm font-medium text-ink">
        {t(`paymentMethod.${order.paymentMethod}`)} · {t(`paymentStatus.${order.paymentStatus}`)}
      </p>
    </section>
  );
}

/**
 * One of the shopper's orders: where it is now and how it got there, a way to pay while a bKash
 * order waits for its money, the cancel button while the shop has not started packing, and what
 * was ordered at what price. Somebody else's order, or one that is gone, is a 404.
 */
export default async function OrderPage({ params }: Props) {
  const { locale, id } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  if (!(await getCurrentUser())) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: orderPath(id) } },
      locale: appLocale,
    });
    return null;
  }
  const [order, t] = await Promise.all([getOrder(id), getTranslations('orders')]);
  if (!order) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href={ROUTES.orders}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-subtle transition hover:text-brand"
      >
        <ChevronLeft aria-hidden="true" size={16} />
        {t('detail.back')}
      </Link>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
            {t('detail.title')}{' '}
            <span dir="ltr" className="whitespace-nowrap">
              {order.orderNumber}
            </span>
          </h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="text-sm text-subtle">
          {t('placedOn', { date: formatOrderDate(order.placedAt, appLocale) })}
        </p>
      </div>
      <BkashPayPanel
        orderId={order.id}
        totalPoysha={order.totalPoysha}
        awaiting={awaitsBkashPayment(order)}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section aria-labelledby="tracking-title" className={`${CARD} space-y-4 self-start`}>
          <h2 id="tracking-title" className="font-display text-xl font-semibold text-ink">
            {t('detail.tracking')}
          </h2>
          <OrderTimeline order={order} />
          <CancelOrder
            orderId={order.id}
            orderNumber={order.orderNumber}
            canCancel={order.canCancel}
          />
        </section>
        <div className="space-y-6">
          <section aria-labelledby="items-title" className={CARD}>
            <h2 id="items-title" className={CARD_HEADING}>
              {t('detail.items')}
            </h2>
            <OrderItems items={order.items} />
            <div className="mt-3 border-t border-border pt-3">
              <OrderTotals order={order} />
            </div>
            {order.status === 'DELIVERED' && LIVE_PAGES.reviews ? (
              <Link
                href={ROUTES.reviews}
                className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98]"
              >
                {t('detail.reviewItems')}
              </Link>
            ) : null}
          </section>
          <DeliveryCard order={order} />
          <PaymentCard order={order} />
        </div>
      </div>
    </div>
  );
}

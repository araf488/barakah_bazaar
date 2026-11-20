import { formatPoysha } from '@barakah/ui';
import { CircleCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { OrderItems, OrderTotals } from '../../../../../components/orders/OrderContents';
import type { StorefrontLocale } from '../../../../../i18n/messages';
import { Link, redirect } from '../../../../../i18n/navigation';
import { placeLine } from '../../../../../lib/account/format';
import { getCurrentUser } from '../../../../../lib/auth/session';
import { getOrder } from '../../../../../lib/checkout/getOrder';
import { homeFilterHref } from '../../../../../lib/homeFilter';
import { orderPath, orderPlacedPath, ROUTES } from '../../../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('checkout.placed.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

/**
 * The page a placed order opens on: its number, what to pay on delivery, where it goes and what
 * is in it. Read from the API, so a reload shows the same order; somebody else's id is a 404.
 */
export default async function OrderPlacedPage({ params }: Props) {
  const { locale, id } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  if (!(await getCurrentUser())) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: orderPlacedPath(id) } },
      locale: appLocale,
    });
    return null;
  }
  const [order, t] = await Promise.all([getOrder(id), getTranslations('checkout')]);
  if (!order) {
    notFound();
  }
  const total = formatPoysha(order.totalPoysha, appLocale);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-3 text-center">
        <CircleCheck aria-hidden="true" size={48} className="mx-auto text-brand" />
        <h1 className="font-display text-3xl font-semibold text-ink">
          {t('placed.heading', { name: order.recipientName })}
        </h1>
        <p className="text-subtle">
          {t('placed.number')}{' '}
          <span dir="ltr" className="font-semibold text-ink">
            {order.orderNumber}
          </span>
        </p>
        <p className="rounded-2xl bg-gold/10 px-4 py-3 font-medium text-ink">
          {t('placed.payOnDelivery', { total })}
        </p>
      </div>
      <section
        aria-labelledby="deliver-title"
        className="rounded-2xl border border-border bg-white p-5"
      >
        <h2 id="deliver-title" className="mb-2 text-sm font-semibold text-subtle">
          {t('placed.deliverTo')}
        </h2>
        <p className="text-sm font-medium text-ink">
          {order.recipientName} · <span dir="ltr">{order.phone}</span>
        </p>
        <p className="mt-1 text-sm text-subtle">{placeLine(order)}</p>
        {order.customerNote ? (
          <p className="mt-3 border-t border-border pt-3 text-sm text-subtle">
            <span className="font-medium text-ink">{t('placed.note')}: </span>
            {order.customerNote}
          </p>
        ) : null}
      </section>
      <section
        aria-labelledby="items-title"
        className="rounded-2xl border border-border bg-white p-5"
      >
        <h2 id="items-title" className="mb-2 text-sm font-semibold text-subtle">
          {t('placed.items')}
        </h2>
        <OrderItems items={order.items} />
        <div className="mt-3 border-t border-border pt-3">
          <OrderTotals order={order} />
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href={homeFilterHref({ kind: 'all' })}
          className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-8 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light active:scale-[0.98]"
        >
          {t('placed.continue')}
        </Link>
        <Link
          href={orderPath(order.id)}
          className="inline-flex min-h-12 items-center rounded-2xl border border-border bg-white px-6 font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98]"
        >
          {t('placed.track')}
        </Link>
      </div>
    </div>
  );
}

import { formatCount, formatPoysha, pickLocalized } from '@barakah/ui';
import { CircleCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import type { StorefrontLocale } from '../../../../../i18n/messages';
import { Link, redirect } from '../../../../../i18n/navigation';
import { placeLine } from '../../../../../lib/account/format';
import { getCurrentUser } from '../../../../../lib/auth/session';
import { getOrder } from '../../../../../lib/checkout/getOrder';
import { homeFilterHref } from '../../../../../lib/homeFilter';
import { orderPlacedPath, ROUTES } from '../../../../../lib/routes';

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
        <ul className="divide-y divide-border">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-medium text-ink">
                  {
                    pickLocalized(
                      { nameEn: item.productNameEn, nameBn: item.productNameBn },
                      appLocale,
                    ).text
                  }
                </span>
                <span className="text-subtle">
                  {t('lineQuantity', {
                    quantity: formatCount(item.quantity, appLocale),
                    size: item.variantNameEn,
                  })}
                </span>
              </span>
              <span className="shrink-0 text-ink">
                {formatPoysha(item.lineTotalPoysha, appLocale)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-subtle">{t('subtotal')}</dt>
            <dd className="text-ink">{formatPoysha(order.subtotalPoysha, appLocale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-subtle">{t('delivery')}</dt>
            <dd className="text-ink">
              {order.deliveryFeePoysha === 0
                ? t('deliveryFree')
                : formatPoysha(order.deliveryFeePoysha, appLocale)}
            </dd>
          </div>
          {order.discountPoysha > 0 ? (
            <div className="flex justify-between">
              <dt className="text-subtle">{t('discountTotal')}</dt>
              <dd className="text-brand">
                {'−'}
                {formatPoysha(order.discountPoysha, appLocale)}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="font-semibold text-ink">{t('total')}</dt>
            <dd className="font-display text-lg font-bold text-ink">{total}</dd>
          </div>
        </dl>
      </section>
      <div className="text-center">
        <Link
          href={homeFilterHref({ kind: 'all' })}
          className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-8 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light active:scale-[0.98]"
        >
          {t('placed.continue')}
        </Link>
      </div>
    </div>
  );
}

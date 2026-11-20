import { formatCount } from '@barakah/ui';
import { PackageOpen } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { OrderCard } from '../../../../components/orders/OrderCard';
import { OrderFilters } from '../../../../components/orders/OrderFilters';
import { OrderListSkeleton } from '../../../../components/orders/OrderListSkeleton';
import type { StorefrontLocale } from '../../../../i18n/messages';
import { Link, redirect } from '../../../../i18n/navigation';
import { getCurrentUser } from '../../../../lib/auth/session';
import { homeFilterHref } from '../../../../lib/homeFilter';
import type { OrderPage } from '../../../../lib/orders/api';
import { getOrders } from '../../../../lib/orders/getOrders';
import {
  ALL_ORDERS,
  type OrderListParams,
  orderListQuery,
  parseOrderListParams,
} from '../../../../lib/orders/listQuery';
import { ROUTES } from '../../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('orders.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

const QUIET_BUTTON =
  'inline-flex min-h-11 items-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98]';
const PRIMARY_BUTTON =
  'inline-flex min-h-12 items-center rounded-2xl bg-brand px-6 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light active:scale-[0.98]';

const listHref = (list: OrderListParams) => ({
  pathname: ROUTES.orders,
  query: orderListQuery(list),
});

interface ListProps {
  list: OrderListParams;
  locale: StorefrontLocale;
}

/** Newer and older pages; nothing when every order fits on one. */
async function Pagination({ list, locale, page }: ListProps & { page: OrderPage }) {
  const t = await getTranslations('orders');
  const { meta } = page;
  if (meta.totalPages <= 1) {
    return null;
  }
  return (
    <nav aria-label={t('pagesLabel')} className="flex items-center justify-between gap-3">
      {list.page > 1 ? (
        <Link href={listHref({ ...list, page: list.page - 1 })} className={QUIET_BUTTON}>
          {t('newer')}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-subtle">
        {t('pageOf', {
          page: formatCount(meta.page, locale),
          total: formatCount(meta.totalPages, locale),
        })}
      </span>
      {meta.hasNextPage ? (
        <Link href={listHref({ ...list, page: list.page + 1 })} className={QUIET_BUTTON}>
          {t('older')}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** No orders at all invites a first one; an empty filter offers the whole list instead. */
async function EmptyOrders({ list }: { list: OrderListParams }) {
  const t = await getTranslations('orders');
  const filtered = list.filter !== ALL_ORDERS || list.page > 1;
  return (
    <div className="rounded-2xl border border-border bg-white px-6 py-12 text-center">
      <PackageOpen aria-hidden="true" size={40} className="mx-auto text-subtle" />
      <p className="mt-3 font-medium text-ink">{filtered ? t('emptyFiltered') : t('empty')}</p>
      <div className="mt-5">
        {filtered ? (
          <Link href={listHref({ filter: ALL_ORDERS, page: 1 })} className={QUIET_BUTTON}>
            {t('showAll')}
          </Link>
        ) : (
          <Link href={homeFilterHref({ kind: 'all' })} className={PRIMARY_BUTTON}>
            {t('startShopping')}
          </Link>
        )}
      </div>
    </div>
  );
}

/** The list could not be read: say so and offer the same page again. */
async function OrdersUnavailable({ list }: { list: OrderListParams }) {
  const t = await getTranslations('orders');
  return (
    <div
      role="alert"
      className="rounded-2xl border border-border bg-white px-6 py-10 text-center text-sm text-ink"
    >
      <p>{t('loadError')}</p>
      <Link href={listHref(list)} className={`${QUIET_BUTTON} mt-4`}>
        {t('retry')}
      </Link>
    </div>
  );
}

async function OrderList({ list, locale }: ListProps) {
  const outcome = await getOrders(list);
  if (!outcome.ok) {
    return <OrdersUnavailable list={list} />;
  }
  if (outcome.page.items.length === 0) {
    return <EmptyOrders list={list} />;
  }
  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {outcome.page.items.map((order) => (
          <li key={order.id}>
            <OrderCard order={order} />
          </li>
        ))}
      </ul>
      <Pagination list={list} locale={locale} page={outcome.page} />
    </div>
  );
}

/**
 * The signed-in shopper's orders, newest first, filtered and paged through the address bar so
 * every view is a link. A visitor who is not signed in is sent to sign in and brought back.
 */
export default async function OrdersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  if (!(await getCurrentUser())) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: ROUTES.orders } },
      locale: appLocale,
    });
    return null;
  }
  const [list, t] = await Promise.all([
    searchParams.then(parseOrderListParams),
    getTranslations('orders'),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-semibold text-ink">{t('title')}</h1>
      <OrderFilters active={list.filter} />
      <Suspense key={`${list.filter}:${list.page}`} fallback={<OrderListSkeleton />}>
        <OrderList list={list} locale={appLocale} />
      </Suspense>
    </div>
  );
}

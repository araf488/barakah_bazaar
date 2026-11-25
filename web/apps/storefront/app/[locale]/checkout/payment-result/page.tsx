import { CircleAlert, CircleCheck, Clock } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BkashPayPanel } from '../../../../components/payments/BkashPayPanel';
import type { StorefrontLocale } from '../../../../i18n/messages';
import { Link, redirect } from '../../../../i18n/navigation';
import { getCurrentUser } from '../../../../lib/auth/session';
import type { Order } from '../../../../lib/checkout/api';
import { findOrderByNumber } from '../../../../lib/payments/findOrder';
import {
  type PaymentOutcome,
  type PaymentResultParams,
  parsePaymentResult,
} from '../../../../lib/payments/outcome';
import { awaitsBkashPayment } from '../../../../lib/payments/rules';
import { orderPath, ROUTES } from '../../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ order?: string | string[]; outcome?: string | string[] }>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('payment.result.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

/**
 * A tick for money received, a clock while bKash decides, a warning when it failed. A payment the
 * shopper cancelled is their own choice, not a fault, so its mark is quiet.
 */
const OUTCOME_ICON: Record<PaymentOutcome, { Icon: typeof CircleCheck; tone: string }> = {
  paid: { Icon: CircleCheck, tone: 'text-brand' },
  pending: { Icon: Clock, tone: 'text-gold' },
  failed: { Icon: CircleAlert, tone: 'text-red-700' },
  cancelled: { Icon: CircleAlert, tone: 'text-subtle' },
};

const LINK_BUTTON =
  'inline-flex min-h-12 items-center rounded-2xl border border-border bg-white px-6 font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98]';

/** This page's own address with its query, so signing in brings the shopper back to it. */
const selfPath = ({ orderNumber, outcome }: PaymentResultParams): string =>
  `${ROUTES.paymentResult}?${new URLSearchParams({
    ...(orderNumber ? { order: orderNumber } : {}),
    outcome,
  })}`;

/**
 * Trying again makes sense only when bKash said the attempt did not complete and the order still
 * waits. While bKash is still deciding, a second attempt could take the money twice.
 */
const offersRetry = (outcome: PaymentOutcome, order: Order | null): boolean =>
  order !== null && (outcome === 'failed' || outcome === 'cancelled') && awaitsBkashPayment(order);

/**
 * Where the API's bKash callback sends the shopper back to, with the order number and one word
 * for how the payment ended. The word comes from bKash and the ledger, never from the browser,
 * but it is still only shown, never acted on: the order page reads the order itself.
 */
export default async function PaymentResultPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  const result = parsePaymentResult(await searchParams);
  if (!(await getCurrentUser())) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: selfPath(result) } },
      locale: appLocale,
    });
    return null;
  }
  const [order, t] = await Promise.all([
    result.orderNumber ? findOrderByNumber(result.orderNumber) : Promise.resolve(null),
    getTranslations('payment.result'),
  ]);
  const { Icon, tone } = OUTCOME_ICON[result.outcome];

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-3 text-center">
        <Icon aria-hidden="true" size={48} className={`mx-auto ${tone}`} />
        <h1 className="font-display text-3xl font-semibold text-ink">
          {t(`${result.outcome}.heading`)}
        </h1>
        {order ? (
          <p className="text-subtle">
            {t('order')}{' '}
            <span dir="ltr" className="whitespace-nowrap font-semibold text-ink">
              {order.orderNumber}
            </span>
          </p>
        ) : null}
        <p className="text-ink">{t(`${result.outcome}.body`)}</p>
      </div>
      {order ? (
        <BkashPayPanel
          orderId={order.id}
          totalPoysha={order.totalPoysha}
          awaiting={offersRetry(result.outcome, order)}
        />
      ) : (
        <p className="rounded-2xl bg-warm px-4 py-3 text-sm text-ink">{t('noOrder')}</p>
      )}
      <div className="text-center">
        <Link href={order ? orderPath(order.id) : ROUTES.orders} className={LINK_BUTTON}>
          {order ? t('seeOrder') : t('allOrders')}
        </Link>
      </div>
    </div>
  );
}

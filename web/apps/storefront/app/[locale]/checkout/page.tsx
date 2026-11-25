import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AddressBook } from '../../../components/account/AddressBook';
import { AddressChooser } from '../../../components/checkout/AddressChooser';
import { PLACE_ORDER_FORM_ID } from '../../../components/checkout/formId';
import { OrderSummary } from '../../../components/checkout/OrderSummary';
import { PaymentChooser } from '../../../components/checkout/PaymentChooser';
import { SlotPicker } from '../../../components/checkout/SlotPicker';
import type { StorefrontLocale } from '../../../i18n/messages';
import { Link, redirect } from '../../../i18n/navigation';
import { getCurrentUser } from '../../../lib/auth/session';
import { checkoutBlocker } from '../../../lib/checkout/blocker';
import { type CheckoutData, getCheckout } from '../../../lib/checkout/getCheckout';
import { MAX_NOTE_LENGTH } from '../../../lib/checkout/rules';
import { homeFilterHref } from '../../../lib/homeFilter';
import { getPaymentMethods } from '../../../lib/payments/methods';
import { ROUTES } from '../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ address?: string | string[] }>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('checkout.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

const NOTICE =
  'rounded-2xl border border-border bg-white px-6 py-10 text-center text-sm text-subtle';
const ALERT = 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800';

function Step({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-display text-xl font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

async function AddressStep({ data }: { data: CheckoutData }) {
  const t = await getTranslations('checkout');
  if (data.addresses === null) {
    return (
      <p role="alert" className={ALERT}>
        {t('addressLoadError')}
      </p>
    );
  }
  if (!data.selected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-subtle">{t('addFirstAddress')}</p>
        <AddressBook addresses={[]} />
      </div>
    );
  }
  return (
    <>
      <AddressChooser addresses={data.addresses} selectedId={data.selected.id} />
      <Link
        href={ROUTES.account}
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-4 hover:underline"
      >
        {t('manageAddresses')}
      </Link>
    </>
  );
}

async function DeliveryTimeStep({ data }: { data: CheckoutData }) {
  const t = await getTranslations('checkout');
  if (!data.slots) {
    return null;
  }
  if (!data.slots.ok) {
    return (
      <p role="alert" className={ALERT}>
        {t(`errors.${data.slots.error}`)}
      </p>
    );
  }
  return <SlotPicker slots={data.slots.slots} />;
}

async function EmptyCheckout({ failed }: { failed: boolean }) {
  const t = await getTranslations('checkout');
  if (failed) {
    return (
      <p role="alert" className={NOTICE}>
        {t('cartLoadError')}
      </p>
    );
  }
  return (
    <div className={`${NOTICE} space-y-4`}>
      <p>{t('empty')}</p>
      <Link
        href={homeFilterHref({ kind: 'all' })}
        className="inline-flex min-h-11 items-center rounded-full border-2 border-brand px-6 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white active:scale-95"
      >
        {t('emptyAction')}
      </Link>
    </div>
  );
}

/**
 * Checkout for a signed-in shopper: address, delivery time, payment (cash on delivery, and bKash
 * when the API offers it) and a note
 * on the left; the summary and the place-order form on the right (below on a phone).
 */
export default async function CheckoutPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  const user = await getCurrentUser();
  if (!user) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: ROUTES.checkout } },
      locale: appLocale,
    });
    return null;
  }
  const { address } = await searchParams;
  const [data, methods, t] = await Promise.all([
    getCheckout(typeof address === 'string' ? address : undefined),
    getPaymentMethods(),
    getTranslations('checkout'),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="mb-8 font-display text-3xl font-semibold text-ink">{t('title')}</h1>
      {data.cart.status === 'error' || data.cart.lines.length === 0 ? (
        <EmptyCheckout failed={data.cart.status === 'error'} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="space-y-10">
            <Step id="address-title" title={t('address')}>
              <AddressStep data={data} />
            </Step>
            {data.selected ? (
              <>
                <Step id="slot-title" title={t('slotTitle')}>
                  <DeliveryTimeStep data={data} />
                </Step>
                <Step id="payment-title" title={t('paymentTitle')}>
                  <PaymentChooser methods={methods} />
                </Step>
                <div className="space-y-1">
                  <label htmlFor="customer-note" className="text-sm font-medium text-ink">
                    {t('noteLabel')}
                  </label>
                  <textarea
                    id="customer-note"
                    name="customerNote"
                    form={PLACE_ORDER_FORM_ID}
                    rows={3}
                    maxLength={MAX_NOTE_LENGTH}
                    aria-describedby="customer-note-hint"
                    className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  <p id="customer-note-hint" className="text-xs text-subtle">
                    {t('noteHint')}
                  </p>
                </div>
              </>
            ) : null}
          </div>
          <OrderSummary
            cart={data.cart}
            addressId={data.selected?.id ?? null}
            quote={data.quote}
            blocker={checkoutBlocker(data)}
          />
        </div>
      )}
    </div>
  );
}

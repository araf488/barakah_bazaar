import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AddressBook } from '../../../components/account/AddressBook';
import type { StorefrontLocale } from '../../../i18n/messages';
import { redirect } from '../../../i18n/navigation';
import { getAddressBook } from '../../../lib/account/addresses';
import { signOutAction } from '../../../lib/auth/actions';
import { getCurrentUser } from '../../../lib/auth/session';
import { ROUTES } from '../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('account.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

/**
 * The signed-in customer's page: profile and address book (orders, security and devices come
 * with their own tasks). A visitor who is not signed in is sent to sign in and brought back.
 */
export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  const user = await getCurrentUser();
  if (!user) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: ROUTES.account } },
      locale: appLocale,
    });
    return null;
  }
  const [book, t] = await Promise.all([getAddressBook(), getTranslations()]);

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold text-ink">{t('account.title')}</h1>
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium text-subtle transition hover:border-brand hover:bg-warm hover:text-brand active:scale-95"
          >
            {t('auth.signOut')}
          </button>
        </form>
      </div>
      <section
        aria-labelledby="profile-title"
        className="rounded-2xl border border-border bg-white p-5"
      >
        <h2 id="profile-title" className="mb-3 text-sm font-semibold text-subtle">
          {t('account.profile')}
        </h2>
        <p className="font-display text-xl font-semibold text-ink">{user.fullName ?? user.email}</p>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-subtle">{t('account.email')}</dt>
          <dd className="text-ink">{user.email}</dd>
          {user.phone ? (
            <>
              <dt className="text-subtle">{t('account.phone')}</dt>
              <dd className="text-ink">
                <span dir="ltr">{user.phone}</span>
                {user.phoneVerified ? null : (
                  <span className="ml-2 text-xs text-subtle">({t('account.phoneUnverified')})</span>
                )}
              </dd>
            </>
          ) : null}
        </dl>
      </section>
      <section aria-labelledby="addresses-title">
        <h2 id="addresses-title" className="mb-4 font-display text-2xl font-semibold text-ink">
          {t('account.addresses')}
        </h2>
        {book.ok ? (
          <AddressBook addresses={book.addresses} />
        ) : (
          <p
            role="alert"
            className="rounded-2xl border border-border bg-white px-6 py-10 text-center text-sm text-subtle"
          >
            {t('address.loadError')}
          </p>
        )}
      </section>
    </div>
  );
}

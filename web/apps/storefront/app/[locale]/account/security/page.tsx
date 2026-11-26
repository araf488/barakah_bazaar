import { ChevronLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { ChangePasswordForm } from '../../../../components/account/ChangePasswordForm';
import { DeviceList, DeviceListSkeleton } from '../../../../components/account/DeviceList';
import type { StorefrontLocale } from '../../../../i18n/messages';
import { Link, redirect } from '../../../../i18n/navigation';
import { getCurrentUser } from '../../../../lib/auth/session';
import { ROUTES } from '../../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('security.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

/**
 * Sign-in and security: change the password, and see and sign out the devices signed in to the
 * account. A visitor who is not signed in is sent to sign in and brought back.
 */
export default async function SecurityPage({ params }: Props) {
  const { locale } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  if (!(await getCurrentUser())) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: ROUTES.security } },
      locale: appLocale,
    });
    return null;
  }
  const t = await getTranslations('security');

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6">
      <div>
        <Link
          href={ROUTES.account}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-subtle underline-offset-4 transition-colors hover:text-brand hover:underline"
        >
          <ChevronLeft aria-hidden="true" size={16} />
          {t('back')}
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">{t('title')}</h1>
        <p className="mt-2 text-subtle">{t('intro')}</p>
      </div>
      <section
        aria-labelledby="password-title"
        className="rounded-2xl border border-border bg-white p-5 sm:p-6"
      >
        <h2 id="password-title" className="font-display text-2xl font-semibold text-ink">
          {t('password.title')}
        </h2>
        <p className="mb-5 mt-1 text-sm text-subtle">{t('password.intro')}</p>
        <ChangePasswordForm />
      </section>
      <section aria-labelledby="devices-title">
        <h2 id="devices-title" className="font-display text-2xl font-semibold text-ink">
          {t('devices.title')}
        </h2>
        <p className="mb-5 mt-1 text-sm text-subtle">{t('devices.intro')}</p>
        <Suspense fallback={<DeviceListSkeleton label={t('devices.loading')} />}>
          <DeviceList />
        </Suspense>
      </section>
    </div>
  );
}

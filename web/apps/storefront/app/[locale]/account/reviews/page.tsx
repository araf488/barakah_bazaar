import { ChevronLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { MyReviews, MyReviewsSkeleton } from '../../../../components/reviews/MyReviews';
import type { StorefrontLocale } from '../../../../i18n/messages';
import { Link, redirect } from '../../../../i18n/navigation';
import { getCurrentUser } from '../../../../lib/auth/session';
import { REVIEW_SENT_PARAM } from '../../../../lib/reviews/rules';
import { ROUTES } from '../../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props) {
  const t = await getTranslations({ locale: (await params).locale as StorefrontLocale });
  return {
    title: `${t('myReviews.title')} · ${t('pdp.titleSuffix')}`,
    robots: { index: false, follow: false },
  };
}

/**
 * The customer's reviews: delivered products still waiting for one, each with a form, and the
 * reviews already written with where each stands. A visitor who is not signed in is sent to
 * sign in and brought back.
 */
export default async function MyReviewsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const appLocale = locale as StorefrontLocale;
  setRequestLocale(appLocale);
  if (!(await getCurrentUser())) {
    redirect({
      href: { pathname: ROUTES.signIn, query: { next: ROUTES.reviews } },
      locale: appLocale,
    });
    return null;
  }
  const [t, query] = await Promise.all([getTranslations('myReviews'), searchParams]);
  const sent = query?.[REVIEW_SENT_PARAM] === '1';

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
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
      {sent ? (
        <p
          role="status"
          className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm font-medium text-brand"
        >
          {t('sent')}
        </p>
      ) : null}
      <Suspense fallback={<MyReviewsSkeleton label={t('loading')} />}>
        <MyReviews />
      </Suspense>
    </div>
  );
}

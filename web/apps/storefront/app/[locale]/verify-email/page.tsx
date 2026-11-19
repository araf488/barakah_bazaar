import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '../../../components/auth/AuthShell';
import { VerifyEmailForm } from '../../../components/auth/VerifyEmailForm';
import type { StorefrontLocale } from '../../../i18n/messages';
import { authPageMetadata } from '../../../lib/auth/pageMetadata';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}

export const generateMetadata = async ({ params }: Props) =>
  authPageMetadata((await params).locale, 'verify');

/** Landing page of the API's confirmation email (`/verify-email?token=`), or code entry without one. */
export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as StorefrontLocale);
  const t = await getTranslations('auth.verify');
  const token = (Array.isArray(query.token) ? query.token[0] : query.token)?.trim();
  return (
    <AuthShell view="verify">
      <h1 className="mb-5 font-display text-2xl font-semibold text-ink">{t('title')}</h1>
      {token ? (
        <VerifyEmailForm token={token} intro={t('linkIntro')} />
      ) : (
        <VerifyEmailForm intro={t('codeIntro')} />
      )}
    </AuthShell>
  );
}

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '../../../components/auth/AuthShell';
import { ResetPasswordForm } from '../../../components/auth/PasswordResetForms';
import type { StorefrontLocale } from '../../../i18n/messages';
import { authPageMetadata } from '../../../lib/auth/pageMetadata';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}

export const generateMetadata = async ({ params }: Props) =>
  authPageMetadata((await params).locale, 'reset');

/** Landing page of the API's reset email (`/reset-password?token=`), or code entry without one. */
export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as StorefrontLocale);
  const t = await getTranslations('auth.reset');
  const token = (Array.isArray(query.token) ? query.token[0] : query.token)?.trim();
  return (
    <AuthShell view="reset">
      <h1 className="mb-5 font-display text-2xl font-semibold text-ink">{t('title')}</h1>
      {token ? <ResetPasswordForm token={token} /> : <ResetPasswordForm />}
    </AuthShell>
  );
}

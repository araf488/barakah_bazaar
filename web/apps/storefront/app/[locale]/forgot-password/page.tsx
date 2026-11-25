import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '../../../components/auth/AuthShell';
import { ForgotPasswordForm } from '../../../components/auth/PasswordResetForms';
import type { StorefrontLocale } from '../../../i18n/messages';
import { authPageMetadata } from '../../../lib/auth/pageMetadata';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
}

export const generateMetadata = async ({ params }: Props) =>
  authPageMetadata((await params).locale, 'forgot');

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as StorefrontLocale);
  const t = await getTranslations('auth.forgot');
  return (
    <AuthShell view="forgot">
      <h1 className="mb-5 font-display text-2xl font-semibold text-ink">{t('title')}</h1>
      <ForgotPasswordForm />
    </AuthShell>
  );
}

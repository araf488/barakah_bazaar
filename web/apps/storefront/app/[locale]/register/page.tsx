import { setRequestLocale } from 'next-intl/server';

import { AuthShell } from '../../../components/auth/AuthShell';
import { RegisterForm } from '../../../components/auth/RegisterForm';
import type { StorefrontLocale } from '../../../i18n/messages';
import { redirect } from '../../../i18n/navigation';
import { authPageMetadata } from '../../../lib/auth/pageMetadata';
import { getCurrentUser } from '../../../lib/auth/session';
import { ROUTES } from '../../../lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
}

export const generateMetadata = async ({ params }: Props) =>
  authPageMetadata((await params).locale, 'register');

export default async function RegisterPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as StorefrontLocale);
  if (await getCurrentUser()) {
    redirect({ href: ROUTES.home, locale: locale as StorefrontLocale });
  }
  return (
    <AuthShell view="register">
      <RegisterForm />
    </AuthShell>
  );
}

import { setRequestLocale } from 'next-intl/server';

import { AuthShell } from '../../../components/auth/AuthShell';
import { SignInForm } from '../../../components/auth/SignInForm';
import type { StorefrontLocale } from '../../../i18n/messages';
import { redirect } from '../../../i18n/navigation';
import { authPageMetadata } from '../../../lib/auth/pageMetadata';
import { safeNextPath } from '../../../lib/auth/rules';
import { getCurrentUser } from '../../../lib/auth/session';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}

export const generateMetadata = async ({ params }: Props) =>
  authPageMetadata((await params).locale, 'signIn');

/** Signing in again while signed in makes no sense, so a signed-in visitor goes on to `next`. */
export default async function SignInPage({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as StorefrontLocale);
  const next = safeNextPath(Array.isArray(query.next) ? query.next[0] : query.next);
  if (await getCurrentUser()) {
    redirect({ href: next, locale: locale as StorefrontLocale });
  }
  return (
    <AuthShell view="signIn">
      <SignInForm next={next} />
    </AuthShell>
  );
}

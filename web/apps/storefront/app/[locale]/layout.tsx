import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { routing } from '../../i18n/routing';
import type { StorefrontLocale } from '../../i18n/messages';
import { fontVariables } from '../fonts';
import '../globals.css';

interface LocaleParams {
  params: Promise<{ locale: string }>;
}

interface LocaleLayoutProps extends LocaleParams {
  children: ReactNode;
}

/** Narrows the route segment to a supported locale, or ends the request with a 404. */
const requireLocale = async (params: LocaleParams['params']): Promise<StorefrontLocale> => {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return locale;
};

/** Both locales are known at build time, so the locale segment is never an open set. */
export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }));

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return { title: t('title'), description: t('description') };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  return (
    <html lang={locale} className={fontVariables}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

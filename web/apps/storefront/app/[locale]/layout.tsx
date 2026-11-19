import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AnnouncementBar } from '../../components/shell/AnnouncementBar';
import { SiteFooter } from '../../components/shell/SiteFooter';
import { BottomNav } from '../../components/shell/BottomNav';
import { SiteHeader } from '../../components/shell/SiteHeader';
import { routing } from '../../i18n/routing';
import { fetchTopCategories } from '../../lib/api/catalog';
import { getCurrentUser } from '../../lib/auth/session';
import { getCart } from '../../lib/cart/getCart';
import type { StorefrontLocale } from '../../i18n/messages';
import { fontVariables } from '../fonts';
import '../globals.css';

/** Target of the skip link, so keyboard users can jump past the header and nav. */
const MAIN_CONTENT_ID = 'main';
const MAIN_CONTENT_HASH = `#${MAIN_CONTENT_ID}`;

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
  const [categories, user, cart, t] = await Promise.all([
    fetchTopCategories(),
    getCurrentUser(),
    getCart(),
    getTranslations({ locale, namespace: 'shell' }),
  ]);

  return (
    <html lang={locale} className={fontVariables}>
      <body className="flex min-h-screen flex-col pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] has-[[data-sticky-buy]]:pb-[calc(7.5rem+1px+env(safe-area-inset-bottom))] md:pb-0 md:has-[[data-sticky-buy]]:pb-0">
        <NextIntlClientProvider>
          <a
            href={MAIN_CONTENT_HASH}
            className="sr-only z-[300] items-center rounded-full bg-brand px-4 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:inline-flex focus:min-h-11 focus-visible:outline-gold"
          >
            {t('skipToContent')}
          </a>
          <AnnouncementBar />
          <SiteHeader categories={categories} user={user} cart={cart} />
          <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
          <SiteFooter categories={categories} />
          <BottomNav cartCount={cart.itemCount} signedIn={user !== null} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import { ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { CategoryNode } from '../../lib/api/catalog';
import { LIVE_PAGES, ROUTES } from '../../lib/routes';
import { BrandMark } from './BrandMark';
import { CategoryNav } from './CategoryNav';
import { HeaderSearch } from './HeaderSearch';
import { LocaleSwitcher } from './LocaleSwitcher';

/** Sign-in and registration, each shown once its page exists. Signed-out state only, for now. */
function AccountLinks() {
  const t = useTranslations('header');

  return (
    <div className="hidden items-center gap-2 md:flex">
      {LIVE_PAGES.signIn ? (
        <Link
          href={ROUTES.signIn}
          className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-ink underline-offset-4 transition-colors hover:text-brand hover:underline"
        >
          {t('signIn')}
        </Link>
      ) : null}
      {LIVE_PAGES.register ? (
        <Link
          href={ROUTES.register}
          className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-light active:scale-95"
        >
          {t('join')}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The sticky header: logo, search, language, account and cart, with the category row beneath.
 * Links to pages that do not exist yet stay hidden (`LIVE_PAGES`), so early on this is the logo,
 * search and the language switch.
 */
export function SiteHeader({ categories }: { categories: CategoryNode[] }) {
  const t = useTranslations('header');
  const shell = useTranslations('shell');

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-white/95 shadow-sm shadow-brand/5 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-4 lg:gap-8">
          <Link
            href={ROUTES.home}
            aria-label={shell('homeLink')}
            className="flex min-h-11 shrink-0 items-center rounded-xl transition-opacity hover:opacity-80"
          >
            <BrandMark tone="onLight" />
          </Link>
          <HeaderSearch />
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0 lg:gap-4">
            <LocaleSwitcher />
            <AccountLinks />
            {LIVE_PAGES.cart ? (
              <Link
                href={ROUTES.cart}
                className="flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-light active:scale-95"
              >
                <ShoppingBag aria-hidden="true" size={18} />
                <span className="sr-only sm:not-sr-only">{t('cart')}</span>
              </Link>
            ) : null}
          </div>
        </div>
        <CategoryNav categories={categories} />
      </div>
    </header>
  );
}

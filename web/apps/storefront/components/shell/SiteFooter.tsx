import { LocalizedName } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { CategoryNode } from '../../lib/api/catalog';
import { BKASH_LABEL } from '../../lib/brand';
import { categoryPath, LIVE_PAGES, type LivePage, ROUTES } from '../../lib/routes';
import { BrandMark } from './BrandMark';

/** The footer's Shop column lists this many top-level categories. */
export const FOOTER_CATEGORY_LIMIT = 6;

const COLUMN_HEADING = 'mb-2 text-sm font-semibold text-white';
const PAYMENT_HEADING = 'mb-4 text-sm font-semibold text-white';
const COLUMN_LINK =
  'inline-flex min-h-11 items-center underline-offset-4 transition-colors hover:text-white hover:underline';
const PAYMENT_CHIP =
  'rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/80';

/** Help destinations, each shown once its page exists. */
const HELP_LINKS = [
  { page: 'orders', href: ROUTES.orders, label: 'trackOrder' },
  { page: 'account', href: ROUTES.account, label: 'account' },
] as const satisfies ReadonlyArray<{ page: LivePage; href: string; label: string }>;

/**
 * Brand blurb, shop and help links, and payment methods. Only what exists is listed: Cash on
 * Delivery and bKash (the API has no Nagad, Rocket or SSLCommerz), no courier names (no courier
 * integration), and only links to pages the storefront has. A column with nothing to link is
 * left out rather than shown empty.
 */
export function SiteFooter({ categories }: { categories: CategoryNode[] }) {
  const t = useTranslations('footer');
  const shell = useTranslations('shell');
  const locale = useLocale();
  const year = new Date().getFullYear();
  const shopCategories = LIVE_PAGES.category ? categories.slice(0, FOOTER_CATEGORY_LIMIT) : [];
  const helpLinks = HELP_LINKS.filter((link) => LIVE_PAGES[link.page]);

  return (
    <footer className="bg-brand-dark text-white/70 [&_:focus-visible]:outline-gold">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="mb-12 flex flex-wrap gap-x-16 gap-y-10">
          <div className="max-w-xs">
            <Link
              href={ROUTES.home}
              aria-label={shell('homeLink')}
              className="mb-4 inline-flex min-h-11 items-center"
            >
              <BrandMark tone="onDark" />
            </Link>
            <p className="mb-5 text-sm leading-relaxed">{t('about')}</p>
            <p className="font-display text-xs text-white/60 italic">{t('tagline')}</p>
          </div>
          {shopCategories.length > 0 ? (
            <div>
              <h2 className={COLUMN_HEADING}>{t('shop')}</h2>
              <ul className="text-sm">
                {shopCategories.map((category) => (
                  <li key={category.id}>
                    <Link href={categoryPath(category.slug)} className={COLUMN_LINK}>
                      <LocalizedName entity={category} locale={locale} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {helpLinks.length > 0 ? (
            <div>
              <h2 className={COLUMN_HEADING}>{t('help')}</h2>
              <ul className="text-sm">
                {helpLinks.map((link) => (
                  <li key={link.page}>
                    <Link href={link.href} className={COLUMN_LINK}>
                      {t(link.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h2 className={PAYMENT_HEADING}>{t('weAccept')}</h2>
            <ul className="flex flex-wrap gap-2">
              <li className={PAYMENT_CHIP}>{t('cashOnDelivery')}</li>
              <li className={PAYMENT_CHIP} lang="en">
                {BKASH_LABEL}
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/60">
          <span>{t('copyright', { year })}</span>
          <span>{t('location')}</span>
        </div>
      </div>
    </footer>
  );
}

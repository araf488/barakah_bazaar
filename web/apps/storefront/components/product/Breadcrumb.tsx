import { LocalizedName } from '@barakah/ui';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { CategoryNode, ProductDetail } from '../../lib/api/catalog';
import { homeFilterHref } from '../../lib/homeFilter';
import { categoryPath, LIVE_PAGES, ROUTES } from '../../lib/routes';

const CRUMB_LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center font-medium underline-offset-4 transition-colors hover:text-brand hover:underline';

/**
 * Home, the product's category, the product. The category crumb filters the home grid until
 * category pages exist; it is left out when the category is not in the tree (e.g. inactive).
 */
export function Breadcrumb({
  category,
  product,
}: {
  category: CategoryNode | undefined;
  product: Pick<ProductDetail, 'nameEn' | 'nameBn'>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const separator = <ChevronRight aria-hidden="true" size={14} className="shrink-0" />;

  return (
    <nav aria-label={t('pdp.breadcrumb')}>
      <ol className="flex flex-wrap items-center gap-x-2 text-sm text-subtle">
        <li className="flex items-center gap-2">
          <Link href={ROUTES.home} className={CRUMB_LINK}>
            {t('header.home')}
          </Link>
          {separator}
        </li>
        {category ? (
          <li className="flex items-center gap-2">
            <Link
              href={
                LIVE_PAGES.category
                  ? categoryPath(category.slug)
                  : homeFilterHref({ kind: 'category', slug: category.slug })
              }
              className={CRUMB_LINK}
            >
              <LocalizedName entity={category} locale={locale} />
            </Link>
            {separator}
          </li>
        ) : null}
        <li aria-current="page" className="line-clamp-1 font-medium text-ink">
          <LocalizedName entity={product} locale={locale} />
        </li>
      </ol>
    </nav>
  );
}

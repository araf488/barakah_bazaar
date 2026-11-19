import { LocalizedName } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import type { CategoryNode } from '../../lib/api/catalog';
import { categoryPath, LIVE_PAGES, ROUTES } from '../../lib/routes';
import { NavLink } from './NavLink';

/**
 * The header's second row: Home, the admin's top-level categories, then the perishables
 * listing. Figma's "Flash Deals", "Account" and "Admin Portal" entries are gone: the API has no
 * flash deals, the account lives in the header's top row, and staff sign in at /admin.
 *
 * Category and Fresh links appear only once those pages exist (`LIVE_PAGES`); a row holding
 * nothing but Home is not rendered at all.
 */
export function CategoryNav({ categories }: { categories: CategoryNode[] }) {
  const t = useTranslations('header');
  const locale = useLocale();
  const shownCategories = LIVE_PAGES.category ? categories : [];

  if (shownCategories.length === 0 && !LIVE_PAGES.fresh) {
    return null;
  }

  return (
    <nav aria-label={t('categoryNav')} className="border-t border-border">
      <ul className="flex gap-1 overflow-x-auto py-1">
        <li>
          <NavLink href={ROUTES.home}>{t('home')}</NavLink>
        </li>
        {shownCategories.map((category) => (
          <li key={category.id}>
            <NavLink href={categoryPath(category.slug)}>
              <LocalizedName entity={category} locale={locale} />
            </NavLink>
          </li>
        ))}
        {LIVE_PAGES.fresh ? (
          <li>
            <NavLink href={ROUTES.fresh}>{t('freshDaily')}</NavLink>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

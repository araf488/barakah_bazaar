import { LocalizedName, pickLocalized } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { CategoryNode } from '../../lib/api/catalog';
import { homeFilterHref } from '../../lib/homeFilter';
import { categoryPath, LIVE_PAGES } from '../../lib/routes';
import { Eyebrow } from '../Eyebrow';
import { headingTags } from '../richText';

/** Rendered size of a tile image, for the browser to reserve space. */
const TILE_IMAGE_SIZE = 200;

/**
 * A category without an image shows its first letter in the display face on the warm tile,
 * a placeholder that reads as one rather than a stock photo standing in for the category.
 */
function TileImage({ category }: { category: CategoryNode }) {
  const locale = useLocale();
  if (category.imageUrl) {
    return (
      <img
        src={category.imageUrl}
        alt=""
        width={TILE_IMAGE_SIZE}
        height={TILE_IMAGE_SIZE}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center font-display text-4xl text-brand/40"
    >
      {Array.from(pickLocalized(category, locale).text)[0]}
    </span>
  );
}

/**
 * The admin's top-level categories as tiles. Until category pages exist, a tile filters the
 * new-arrivals grid on this page instead (`?category=slug#new-arrivals`), a real destination.
 */
export function CategoryTiles({ categories }: { categories: CategoryNode[] }) {
  const t = useTranslations('home.categories');
  const locale = useLocale();

  if (categories.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="categories-title"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <Eyebrow className="mb-2 text-subtle">{t('eyebrow')}</Eyebrow>
      <h2 id="categories-title" className="mb-8 font-display text-3xl text-ink sm:text-4xl">
        {t.rich('title', headingTags('text-brand'))}
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              href={
                LIVE_PAGES.category
                  ? categoryPath(category.slug)
                  : homeFilterHref({ kind: 'category', slug: category.slug })
              }
              className="group flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-white p-3 transition duration-300 hover:-translate-y-1 hover:border-brand hover:shadow-lg active:translate-y-0"
            >
              <span className="block aspect-square w-full overflow-hidden rounded-xl bg-warm">
                <TileImage category={category} />
              </span>
              <span className="text-center text-xs leading-tight font-semibold text-ink">
                <LocalizedName entity={category} locale={locale} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

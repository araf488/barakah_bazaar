import { LocalizedName } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, Suspense } from 'react';

import { Link } from '../../i18n/navigation';
import type { CategoryNode } from '../../lib/api/catalog';
import {
  type HomeFilter,
  homeFilterHref,
  isSameFilter,
  NEW_ARRIVALS_ID,
} from '../../lib/homeFilter';
import { Eyebrow } from '../Eyebrow';
import { ProductGrid, ProductGridSkeleton } from './ProductGrid';

const CHIP =
  'inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-5 text-sm font-semibold transition active:scale-95';
const CHIP_IDLE = 'border-border bg-white text-subtle hover:border-brand hover:text-brand';
const CHIP_ACTIVE = 'border-brand bg-brand text-white shadow-md shadow-brand/20';

interface ChipProps {
  filter: HomeFilter;
  active: HomeFilter;
  children: ReactNode;
}

/** A filter is a link, so it works without JavaScript and survives a reload or a shared URL. */
function Chip({ filter, active, children }: ChipProps) {
  const current = isSameFilter(filter, active);
  return (
    <li>
      <Link
        href={homeFilterHref(filter)}
        scroll={false}
        aria-current={current ? 'true' : undefined}
        className={`${CHIP} ${current ? CHIP_ACTIVE : CHIP_IDLE}`}
      >
        {children}
      </Link>
    </li>
  );
}

interface NewArrivalsProps {
  filter: HomeFilter;
  categories: CategoryNode[];
}

/**
 * The newest products, filterable by category or by perishables. Named for what it is: the API
 * has no "featured" flag, so the Figma's "Featured Products / Handpicked For You" would be a
 * claim nobody made. The grid streams in behind its loading state.
 */
export function NewArrivals({ filter, categories }: NewArrivalsProps) {
  const t = useTranslations('home.products');
  const locale = useLocale();
  const filterKey = filter.kind === 'category' ? `category:${filter.slug}` : filter.kind;

  return (
    <section
      id={NEW_ARRIVALS_ID}
      aria-labelledby="new-arrivals-title"
      className="mx-auto max-w-7xl scroll-mt-32 px-4 py-16 sm:px-6 lg:px-8"
    >
      <Eyebrow className="mb-2 text-subtle">{t('eyebrow')}</Eyebrow>
      <h2 id="new-arrivals-title" className="mb-8 font-display text-3xl text-ink sm:text-4xl">
        {t('title')}
      </h2>
      <nav aria-label={t('filters')} className="mb-8">
        <ul className="flex gap-2 overflow-x-auto pb-2">
          <Chip filter={{ kind: 'all' }} active={filter}>
            {t('all')}
          </Chip>
          <Chip filter={{ kind: 'fresh' }} active={filter}>
            {t('fresh')}
          </Chip>
          {categories.map((category) => (
            <Chip
              key={category.id}
              filter={{ kind: 'category', slug: category.slug }}
              active={filter}
            >
              <LocalizedName entity={category} locale={locale} />
            </Chip>
          ))}
        </ul>
      </nav>
      <Suspense key={filterKey} fallback={<ProductGridSkeleton />}>
        <ProductGrid filter={filter} />
      </Suspense>
    </section>
  );
}

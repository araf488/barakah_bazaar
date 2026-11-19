import { useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import { listNewestProducts, type ProductListResult } from '../../lib/api/catalog';
import { getCart } from '../../lib/cart/getCart';
import { type CartLineView, linesBySlug } from '../../lib/cart/view';
import {
  type HomeFilter,
  HOME_PRODUCT_LIMIT,
  homeFilterHref,
  toProductFilter,
} from '../../lib/homeFilter';
import { ProductCard } from '../product/ProductCard';

const GRID = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5';
const MESSAGE =
  'rounded-2xl border border-border bg-white px-6 py-12 text-center text-sm text-subtle';

/** Placeholder cards in the grid's exact shape, so nothing jumps when products arrive. */
export function ProductGridSkeleton() {
  const t = useTranslations('home.products');

  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <ul aria-hidden="true" className={GRID}>
        {Array.from({ length: HOME_PRODUCT_LIMIT }, (_, index) => (
          <li key={index} className="overflow-hidden rounded-2xl border border-border bg-white">
            <span className="block aspect-square animate-pulse bg-warm" />
            <span className="block p-4">
              <span className="mb-3 block h-4 w-3/4 animate-pulse rounded bg-warm" />
              <span className="block h-5 w-1/3 animate-pulse rounded bg-warm" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ProductGridResultProps {
  result: ProductListResult;
  filter: HomeFilter;
  /** Cart lines by product slug, so each card shows its quick-add state. */
  cartLines?: ReadonlyMap<string, CartLineView[]>;
}

/** One loaded page of new arrivals, or its empty or error state. */
export function ProductGridResult({
  result,
  filter,
  cartLines = new Map(),
}: ProductGridResultProps) {
  const t = useTranslations('home.products');

  if (!result.ok) {
    return (
      <p role="alert" className={MESSAGE}>
        {t('error')}
      </p>
    );
  }

  if (result.page.items.length === 0) {
    return filter.kind === 'all' ? (
      <p className={MESSAGE}>{t('emptyAll')}</p>
    ) : (
      <div className={MESSAGE}>
        <p className="mb-4">{t('empty')}</p>
        <Link
          href={homeFilterHref({ kind: 'all' })}
          scroll={false}
          className="inline-flex min-h-11 items-center rounded-full border-2 border-brand px-6 font-semibold text-brand transition hover:bg-brand hover:text-white active:scale-95"
        >
          {t('showAll')}
        </Link>
      </div>
    );
  }

  return (
    <ul className={GRID}>
      {result.page.items.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} cartLines={cartLines.get(product.slug) ?? []} />
        </li>
      ))}
    </ul>
  );
}

/** Loads one filtered page of new arrivals; suspends behind {@link ProductGridSkeleton}. */
export async function ProductGrid({ filter }: { filter: HomeFilter }) {
  const [result, cart] = await Promise.all([
    listNewestProducts(toProductFilter(filter)),
    getCart(),
  ]);
  return <ProductGridResult result={result} filter={filter} cartLines={linesBySlug(cart)} />;
}

'use client';

import { LocalizedName } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '../../i18n/navigation';
import type { ProductListItem } from '../../lib/api/catalog';
import { LIVE_PAGES, productPath } from '../../lib/routes';

/** Side of the square result thumbnail, in CSS pixels. */
const THUMBNAIL_SIZE = 56;

const ROW = 'flex w-full items-center gap-4 rounded-xl p-3 text-left';

interface SearchResultsProps {
  items: ProductListItem[];
  onNavigate: () => void;
}

/** Thumbnail, name in the reader's language, and the cheapest variant's price. */
function ResultContent({ product }: { product: ProductListItem }) {
  const t = useTranslations('product');
  const locale = useLocale();

  return (
    <>
      <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-warm">
        {product.primaryImage ? (
          // Product images come from the API's storage host, which is configured per
          // environment; a plain <img> avoids pinning that host in next.config.
          <img
            src={product.primaryImage.url}
            alt=""
            width={THUMBNAIL_SIZE}
            height={THUMBNAIL_SIZE}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          <LocalizedName entity={product} locale={locale} />
        </span>
        <span className="mt-1 block text-sm font-bold text-brand">
          {t('fromPrice', { price: product.fromPriceFormatted })}
        </span>
      </span>
    </>
  );
}

/**
 * One row per match. Rows link to the product page once it exists (`LIVE_PAGES.product`);
 * until then they are plain rows, never a link to a 404.
 */
export function SearchResults({ items, onNavigate }: SearchResultsProps) {
  const row = (product: ProductListItem): ReactNode =>
    LIVE_PAGES.product ? (
      <Link
        href={productPath(product.slug)}
        onClick={onNavigate}
        className={`group ${ROW} transition-colors hover:bg-warm focus-visible:bg-warm focus-visible:outline-offset-[-2px] active:bg-border`}
      >
        <ResultContent product={product} />
      </Link>
    ) : (
      <div className={ROW}>
        <ResultContent product={product} />
      </div>
    );

  return (
    <ul className="max-h-[60vh] overflow-y-auto p-3">
      {items.map((product) => (
        <li key={product.id}>{row(product)}</li>
      ))}
    </ul>
  );
}

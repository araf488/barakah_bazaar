import { LocalizedName } from '@barakah/ui';
import { Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '../../i18n/navigation';
import type { ProductListItem } from '../../lib/api/catalog';
import { LIVE_PAGES, productPath } from '../../lib/routes';

/** Rendered size of the square card image, for the browser to reserve space. */
const CARD_IMAGE_SIZE = 400;

const CARD = 'group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white';
const CARD_INTERACTIVE =
  'transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand/10 active:translate-y-0';

/**
 * Gold badge for anything that needs the cold chain or spoils, so a shopper sees before opening
 * the product that it travels in a perishable slot. The only badge the API can back.
 */
function HandlingBadge({ product }: { product: ProductListItem }) {
  const t = useTranslations('product.storage');
  if (!product.handling.isPerishable) {
    return null;
  }
  return (
    <span className="absolute top-3 left-3 rounded-full bg-gold px-2.5 py-1 text-[11px] font-semibold text-brand-dark">
      {t(product.handling.storageType)}
    </span>
  );
}

/** Stars only once someone has rated it; "no rating yet" is not "zero stars". */
function Rating({ rating }: { rating: ProductListItem['rating'] }) {
  const t = useTranslations('product');
  if (rating.average === null || rating.count === 0) {
    return null;
  }
  return (
    <p className="mb-2 flex items-center gap-1 text-xs text-subtle">
      <Star aria-hidden="true" size={12} className="fill-gold text-gold" />
      <span aria-hidden="true">
        {rating.average.toFixed(1)} ({rating.count})
      </span>
      <span className="sr-only">
        {t('rating', { average: rating.average.toFixed(1), count: rating.count })}
      </span>
    </p>
  );
}

function CardBody({ product }: { product: ProductListItem }) {
  const t = useTranslations('product');
  const locale = useLocale();

  return (
    <>
      <span className="relative block aspect-square overflow-hidden bg-warm">
        {product.primaryImage ? (
          <img
            src={product.primaryImage.url}
            alt=""
            width={CARD_IMAGE_SIZE}
            height={CARD_IMAGE_SIZE}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : null}
        <HandlingBadge product={product} />
      </span>
      <span className="flex flex-1 flex-col p-4">
        <h3 className="mb-2 line-clamp-2 text-sm leading-snug font-semibold text-ink">
          <LocalizedName entity={product} locale={locale} />
        </h3>
        <Rating rating={product.rating} />
        <span className="mt-auto font-display text-lg font-bold text-brand">
          {t('fromPrice', { price: product.fromPriceFormatted })}
        </span>
      </span>
    </>
  );
}

/**
 * Image, name in the reader's language, rating once there is one, and the cheapest variant's
 * price. The card links to the product page once it exists (`LIVE_PAGES.product`). There is no
 * add-to-cart or wishlist here: a list item carries no variant id, and the API has no wishlist.
 */
export function ProductCard({ product }: { product: ProductListItem }) {
  const content: ReactNode = <CardBody product={product} />;

  return LIVE_PAGES.product ? (
    <Link href={productPath(product.slug)} className={`${CARD} ${CARD_INTERACTIVE}`}>
      {content}
    </Link>
  ) : (
    <div className={CARD}>{content}</div>
  );
}

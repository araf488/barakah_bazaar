import { formatCount, formatPoysha, formatRating, LocalizedName, pickLocalized } from '@barakah/ui';
import { Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '../../i18n/navigation';
import type { ProductListItem } from '../../lib/api/catalog';
import type { CartLineView } from '../../lib/cart/view';
import { LIVE_PAGES, productPath } from '../../lib/routes';
import { QuickAdd } from '../cart/QuickAdd';

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
  const locale = useLocale();
  if (rating.average === null || rating.count === 0) {
    return null;
  }
  const average = formatRating(rating.average, locale);
  const count = formatCount(rating.count, locale);
  return (
    <p className="mb-2 flex items-center gap-1 text-xs text-subtle">
      <Star aria-hidden="true" size={12} className="fill-gold text-gold" />
      <span aria-hidden="true">
        {average} ({count})
      </span>
      <span className="sr-only">{t('rating', { average, count })}</span>
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
          {t('fromPrice', { price: formatPoysha(product.fromPricePoysha, locale) })}
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
export function ProductCard({
  product,
  cartLines = [],
}: {
  product: ProductListItem;
  /** This product's lines already in the cart, for the quick-add stepper. */
  cartLines?: CartLineView[];
}) {
  const locale = useLocale();
  const content: ReactNode = <CardBody product={product} />;

  return (
    <div className="relative h-full">
      {LIVE_PAGES.product ? (
        <Link href={productPath(product.slug)} className={`${CARD} ${CARD_INTERACTIVE}`}>
          {content}
        </Link>
      ) : (
        <div className={CARD}>{content}</div>
      )}
      {/* Over the image's bottom-right corner, outside the link: a button cannot sit in a link. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex aspect-square items-end justify-end p-2">
        <div className="pointer-events-auto">
          <QuickAdd
            slug={product.slug}
            name={pickLocalized(product, locale).text}
            lines={cartLines}
          />
        </div>
      </div>
    </div>
  );
}

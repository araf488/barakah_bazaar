import { Star } from 'lucide-react';
import { formatCount, formatRating } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import type { ProductListItem } from '../../lib/api/catalog';

/**
 * The published average and count from the product itself. With `href`, it links to the written
 * reviews further down the page, so the number leads to what it summarises.
 */
export function RatingSummary({
  rating,
  href,
}: {
  rating: ProductListItem['rating'];
  /** Where the reviews are, such as `#reviews`; without it the summary is plain text. */
  href?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();

  if (rating.average === null || rating.count === 0) {
    return <p className="text-sm text-subtle">{t('pdp.notRated')}</p>;
  }

  const average = formatRating(rating.average, locale);
  const count = formatCount(rating.count, locale);
  const summary = (
    <>
      <Star aria-hidden="true" size={16} className="fill-gold text-gold" />
      <span aria-hidden="true" className="font-semibold text-ink">
        {average}
      </span>
      <span aria-hidden="true" className="text-subtle">
        ({count})
      </span>
      <span className="sr-only">{t('product.rating', { average, count })}</span>
    </>
  );
  if (!href) {
    return <p className="flex items-center gap-1.5 text-sm">{summary}</p>;
  }
  return (
    <p className="text-sm">
      <a
        href={href}
        className="-mx-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 underline-offset-4 hover:underline"
      >
        {summary}
        <span className="text-brand">{t('reviews.seeAll')}</span>
      </a>
    </p>
  );
}

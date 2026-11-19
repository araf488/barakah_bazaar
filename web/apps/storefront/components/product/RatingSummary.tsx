import { Star } from 'lucide-react';
import { formatCount, formatRating } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import type { ProductListItem } from '../../lib/api/catalog';

/**
 * The published average and count from the product itself. Written reviews are not listed:
 * the API's review list requires sign-in, so a guest would only ever see an error there.
 */
export function RatingSummary({ rating }: { rating: ProductListItem['rating'] }) {
  const t = useTranslations();
  const locale = useLocale();

  if (rating.average === null || rating.count === 0) {
    return <p className="text-sm text-subtle">{t('pdp.notRated')}</p>;
  }

  const average = formatRating(rating.average, locale);
  const count = formatCount(rating.count, locale);
  return (
    <p className="flex items-center gap-1.5 text-sm">
      <Star aria-hidden="true" size={16} className="fill-gold text-gold" />
      <span aria-hidden="true" className="font-semibold text-ink">
        {average}
      </span>
      <span aria-hidden="true" className="text-subtle">
        ({count})
      </span>
      <span className="sr-only">{t('product.rating', { average, count })}</span>
    </p>
  );
}

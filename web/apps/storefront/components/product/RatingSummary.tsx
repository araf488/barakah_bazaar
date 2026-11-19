import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ProductListItem } from '../../lib/api/catalog';

/**
 * The published average and count from the product itself. Written reviews are not listed:
 * the API's review list requires sign-in, so a guest would only ever see an error there.
 */
export function RatingSummary({ rating }: { rating: ProductListItem['rating'] }) {
  const t = useTranslations();

  if (rating.average === null || rating.count === 0) {
    return <p className="text-sm text-subtle">{t('pdp.notRated')}</p>;
  }

  const average = rating.average.toFixed(1);
  return (
    <p className="flex items-center gap-1.5 text-sm">
      <Star aria-hidden="true" size={16} className="fill-gold text-gold" />
      <span aria-hidden="true" className="font-semibold text-ink">
        {average}
      </span>
      <span aria-hidden="true" className="text-subtle">
        ({rating.count})
      </span>
      <span className="sr-only">{t('product.rating', { average, count: rating.count })}</span>
    </p>
  );
}

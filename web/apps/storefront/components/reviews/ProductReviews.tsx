import { formatCount, formatRating } from '@barakah/ui';
import { BadgeCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  getProductReviews,
  type ProductReviewsResult,
  type PublishedReview,
} from '../../lib/reviews/api';

import type { StorefrontLocale } from '../../i18n/messages';
import { Link } from '../../i18n/navigation';
import type { ProductListItem } from '../../lib/api/catalog';
import { formatOrderDate } from '../../lib/orders/format';
import { REVIEW_MAX_PAGE_SIZE, REVIEWS_PER_STEP } from '../../lib/reviews/rules';
import { productPath } from '../../lib/routes';
import { StarRow } from './StarRow';

/** The section's id: the rating at the top of the page links here. */
export const REVIEWS_ANCHOR = 'reviews';

/** The product page's query parameter counting "show more" steps. */
export const REVIEWS_PARAM = 'reviews';

const QUIET_BUTTON =
  'inline-flex min-h-11 items-center rounded-xl border border-border bg-white px-5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98]';

/** One published review: its stars, when it was written, and the verified-purchase mark. */
export function ReviewCard({ review }: { review: PublishedReview }) {
  const t = useTranslations('reviews');
  const appLocale = useLocale() as StorefrontLocale;

  return (
    <article className="h-full rounded-2xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          <StarRow rating={review.rating} />
          <span className="sr-only">
            {t('rated', { rating: formatCount(review.rating, appLocale) })}
          </span>
          <time dateTime={review.createdAt} className="text-xs text-subtle">
            {formatOrderDate(review.createdAt, appLocale)}
          </time>
        </p>
        {review.isVerifiedPurchase ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
            <BadgeCheck aria-hidden="true" size={14} />
            {t('verified')}
          </span>
        ) : null}
      </div>
      {review.title ? <h3 className="mt-3 font-semibold text-ink">{review.title}</h3> : null}
      {review.body ? (
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-subtle">
          {review.body}
        </p>
      ) : null}
    </article>
  );
}

interface ProductReviewsProps {
  productId: string;
  slug: string;
  rating: ProductListItem['rating'];
  /** How many reviews to show, from the page's `?reviews=` steps. */
  shown: number;
}

/** The big average beside the heading; only once the product has a published rating. */
function AverageCard({ rating }: { rating: ProductListItem['rating'] }) {
  const t = useTranslations();
  const appLocale = useLocale() as StorefrontLocale;
  if (rating.average === null || rating.count === 0) {
    return null;
  }
  const average = formatRating(rating.average, appLocale);
  const count = formatCount(rating.count, appLocale);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-white px-5 py-3">
      <span aria-hidden="true" className="font-display text-3xl font-bold text-brand">
        {average}
      </span>
      <span aria-hidden="true">
        <StarRow rating={rating.average} />
        <span className="mt-0.5 block text-xs text-subtle">
          {t('reviews.count', { count: rating.count })}
        </span>
      </span>
      <span className="sr-only">{t('product.rating', { average, count })}</span>
    </div>
  );
}

/**
 * Published reviews, newest first, below the product. Anyone can read them. "Show more" is a
 * link (`?reviews=2`, then 3…) so it works without JavaScript and survives a reload.
 */
export async function ProductReviews(props: ProductReviewsProps) {
  const result = await getProductReviews(props.productId, props.shown);
  return <ReviewsSection {...props} result={result} />;
}

/** The section itself, drawn from whatever the review list answered. */
export function ReviewsSection({
  slug,
  rating,
  shown,
  result,
}: ProductReviewsProps & { result: ProductReviewsResult }) {
  const t = useTranslations('reviews');

  return (
    <section
      id={REVIEWS_ANCHOR}
      aria-labelledby="reviews-title"
      className="mt-16 scroll-mt-28 border-t border-border pt-12"
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="reviews-title" className="font-display text-2xl font-semibold text-ink">
            {t('title')}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-subtle">{t('intro')}</p>
        </div>
        <AverageCard rating={rating} />
      </div>
      <ReviewsBody slug={slug} shown={shown} result={result} />
    </section>
  );
}

function ReviewsBody({
  slug,
  shown,
  result,
}: {
  slug: string;
  shown: number;
  result: ProductReviewsResult;
}) {
  const t = useTranslations('reviews');
  const appLocale = useLocale() as StorefrontLocale;
  const steps = Math.ceil(shown / REVIEWS_PER_STEP);

  if (!result.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-border bg-white px-6 py-10 text-center text-sm text-ink"
      >
        <p>{t('loadError')}</p>
        <Link
          href={{
            pathname: productPath(slug),
            query: { [REVIEWS_PARAM]: steps },
            hash: REVIEWS_ANCHOR,
          }}
          className={`${QUIET_BUTTON} mt-4`}
        >
          {t('retry')}
        </Link>
      </div>
    );
  }

  const { items, total } = result.page;
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white px-6 py-10 text-center">
        <p className="font-semibold text-ink">{t('empty')}</p>
        <p className="mt-1 text-sm text-subtle">{t('emptyHint')}</p>
      </div>
    );
  }

  const more = items.length < total && shown < REVIEW_MAX_PAGE_SIZE;
  return (
    <div className="space-y-6">
      <ul className="grid gap-4 md:grid-cols-2">
        {items.map((review) => (
          <li key={review.id}>
            <ReviewCard review={review} />
          </li>
        ))}
      </ul>
      {more ? (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link
            href={{
              pathname: productPath(slug),
              query: { [REVIEWS_PARAM]: steps + 1 },
              hash: REVIEWS_ANCHOR,
            }}
            scroll={false}
            className={QUIET_BUTTON}
          >
            {t('more')}
          </Link>
          <p className="text-sm text-subtle">
            {t('shown', {
              shown: formatCount(items.length, appLocale),
              total: formatCount(total, appLocale),
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

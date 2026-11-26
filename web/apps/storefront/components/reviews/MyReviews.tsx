import { formatCount, pickLocalized } from '@barakah/ui';
import { CircleCheck, ChevronDown, Clock, EyeOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { StorefrontLocale } from '../../i18n/messages';
import { Link } from '../../i18n/navigation';
import { formatOrderDate } from '../../lib/orders/format';
import {
  type AwaitingReview,
  getMyReviews,
  type MyReview,
  type MyReviewsResult,
  type ReviewStatus,
} from '../../lib/reviews/api';
import { productPath, ROUTES } from '../../lib/routes';
import { ReviewForm } from './ReviewForm';
import { StarRow } from './StarRow';

/** Thumbnail edge in CSS pixels; the API's images are square. */
const THUMB_SIZE = 64;

const QUIET_BUTTON =
  'inline-flex min-h-11 items-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98]';

/**
 * Each status with its own icon and tone. The words carry the meaning; a review that was not
 * published reads as neutral, not as an error, since nothing the customer can fix went wrong.
 */
const STATUS_LOOK: Record<ReviewStatus, { icon: typeof Clock; chip: string }> = {
  PENDING: { icon: Clock, chip: 'bg-gold/15 text-ink' },
  PUBLISHED: { icon: CircleCheck, chip: 'bg-brand/10 text-brand' },
  REJECTED: { icon: EyeOff, chip: 'bg-warm text-subtle' },
};

const nameOf = (item: { productNameEn: string; productNameBn: string }, locale: StorefrontLocale) =>
  pickLocalized({ nameEn: item.productNameEn, nameBn: item.productNameBn }, locale).text;

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="block size-16 shrink-0 overflow-hidden rounded-xl bg-warm">
      {url ? (
        <img
          src={url}
          alt=""
          width={THUMB_SIZE}
          height={THUMB_SIZE}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

/** A delivered product still waiting for a review, with the form folded beneath it. */
export function AwaitingItem({ item }: { item: AwaitingReview }) {
  const t = useTranslations('myReviews.awaiting');
  const appLocale = useLocale() as StorefrontLocale;
  const name = nameOf(item, appLocale);

  return (
    <li className="rounded-2xl border border-border bg-white">
      <div className="flex items-center gap-4 p-4">
        <Thumb url={item.imageUrl} />
        <div className="min-w-0 flex-1">
          <Link
            href={productPath(item.productSlug)}
            className="inline-flex min-h-11 items-center font-semibold text-ink underline-offset-4 hover:text-brand hover:underline"
          >
            {name}
          </Link>
          <p className="mt-0.5 text-xs text-subtle">
            {item.variantNameEn}
            {item.deliveredAt
              ? ` · ${t('delivered', { date: formatOrderDate(item.deliveredAt, appLocale) })}`
              : null}
          </p>
          <p className="text-xs text-subtle">
            {t.rich('order', {
              number: item.orderNumber,
              num: (chunks) => <span dir="ltr">{chunks}</span>,
            })}
          </p>
        </div>
      </div>
      <details className="group border-t border-border">
        <summary
          aria-label={t('writeNamed', { product: name })}
          className="flex min-h-12 list-none items-center justify-between gap-2 rounded-b-2xl px-4 text-sm font-semibold text-brand transition-colors hover:bg-warm group-open:rounded-none [&::-webkit-details-marker]:hidden"
        >
          {t('write')}
          <ChevronDown
            aria-hidden="true"
            size={18}
            className="transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="px-4 pt-2 pb-5">
          <ReviewForm orderItemId={item.orderItemId} />
        </div>
      </details>
    </li>
  );
}

/** One of the customer's own reviews, with where it stands. */
export function OwnReview({ review }: { review: MyReview }) {
  const t = useTranslations('myReviews.mine');
  const tReviews = useTranslations('reviews');
  const appLocale = useLocale() as StorefrontLocale;
  const look = STATUS_LOOK[review.status];
  const Icon = look.icon;

  return (
    <li className="rounded-2xl border border-border bg-white p-4 sm:p-5">
      <div className="flex gap-4">
        <Thumb url={review.imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link
              href={productPath(review.productSlug)}
              className="inline-flex min-h-11 items-center font-semibold text-ink underline-offset-4 hover:text-brand hover:underline"
            >
              {nameOf(review, appLocale)}
            </Link>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${look.chip}`}
            >
              <Icon aria-hidden="true" size={14} />
              {t(`status.${review.status}`)}
            </span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <StarRow rating={review.rating} />
            <span className="sr-only">
              {tReviews('rated', { rating: formatCount(review.rating, appLocale) })}
            </span>
            <time dateTime={review.createdAt} className="text-xs text-subtle">
              {t('writtenOn', { date: formatOrderDate(review.createdAt, appLocale) })}
            </time>
          </p>
        </div>
      </div>
      {review.title ? <h3 className="mt-3 font-semibold text-ink">{review.title}</h3> : null}
      {review.body ? (
        <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-subtle">
          {review.body}
        </p>
      ) : null}
      {review.status === 'PUBLISHED' ? null : (
        <p className="mt-3 text-xs text-subtle">{t(`statusHint.${review.status}`)}</p>
      )}
    </li>
  );
}

/** Loads the customer's reviews; the page streams it behind a placeholder. */
export async function MyReviews() {
  return <MyReviewsView outcome={await getMyReviews()} />;
}

/** Both lists, or why there is nothing to show. */
export function MyReviewsView({ outcome }: { outcome: MyReviewsResult }) {
  const t = useTranslations('myReviews');

  if (!outcome.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-border bg-white px-6 py-10 text-center text-sm text-ink"
      >
        <p>{t('loadError')}</p>
        <Link href={ROUTES.reviews} className={`${QUIET_BUTTON} mt-4`}>
          {t('retry')}
        </Link>
      </div>
    );
  }

  const { awaiting, reviews } = outcome.mine;
  if (awaiting.length === 0 && reviews.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-white px-6 py-10 text-center text-sm text-subtle">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {awaiting.length > 0 ? (
        <section aria-labelledby="awaiting-title">
          <h2
            id="awaiting-title"
            className="mb-4 flex flex-wrap items-baseline gap-x-3 font-display text-2xl font-semibold text-ink"
          >
            {t('awaiting.title')}
            <span className="font-sans text-sm font-normal text-subtle">
              {t('awaiting.count', { count: awaiting.length })}
            </span>
          </h2>
          <ul className="space-y-4">
            {awaiting.map((item) => (
              <AwaitingItem key={item.orderItemId} item={item} />
            ))}
          </ul>
        </section>
      ) : null}
      {reviews.length > 0 ? (
        <section aria-labelledby="mine-title">
          <h2 id="mine-title" className="mb-4 font-display text-2xl font-semibold text-ink">
            {t('mine.title')}
          </h2>
          <ul className="space-y-4">
            {reviews.map((review) => (
              <OwnReview key={review.id} review={review} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function MyReviewsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <ul aria-hidden="true" className="space-y-4">
        {[0, 1].map((row) => (
          <li key={row} className="flex gap-4 rounded-2xl border border-border bg-white p-4">
            <span className="size-16 shrink-0 rounded-xl bg-warm motion-safe:animate-pulse" />
            <span className="flex-1">
              <span className="block h-4 w-1/2 rounded bg-warm motion-safe:animate-pulse" />
              <span className="mt-2 block h-3 w-1/3 rounded bg-warm motion-safe:animate-pulse" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

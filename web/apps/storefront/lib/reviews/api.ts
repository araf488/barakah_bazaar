import { cache } from 'react';

import { accountCaller } from '../account/caller';
import { getJson } from '../api/http';
import { serverApiBaseUrl } from '../api/config';
import { type CallerContext, callApi, callApiExplained } from '../auth/api';

// Server-side client for the API's review routes (src/modules/review/review.controller.ts).

/** A published review as the product page shows it. The API never names its author. */
export interface PublishedReview {
  id: string;
  productId: string;
  rating: number;
  title: string | null;
  body: string | null;
  /** Always true: a review can only come from a delivered order line. */
  isVerifiedPurchase: boolean;
  createdAt: string;
}

export interface ReviewPage {
  items: PublishedReview[];
  total: number;
  page: number;
  pageSize: number;
}

export type ReviewStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED';

/** A delivered product the customer has not reviewed yet, one per product. */
export interface AwaitingReview {
  /** What `POST /reviews` takes as `orderItemId`. */
  orderItemId: string;
  productId: string;
  productSlug: string;
  productNameEn: string;
  productNameBn: string;
  variantNameEn: string;
  imageUrl: string | null;
  orderNumber: string;
  deliveredAt: string | null;
}

/** One of the customer's own reviews, with its moderation status. */
export interface MyReview extends PublishedReview {
  status: ReviewStatus;
  productSlug: string;
  productNameEn: string;
  productNameBn: string;
  imageUrl: string | null;
}

export interface MyReviews {
  awaiting: AwaitingReview[];
  reviews: MyReview[];
}

export interface NewReview {
  orderItemId: string;
  rating: number;
  title?: string;
  body?: string;
}

/** Published reviews change only when staff publish one; a minute's staleness is harmless. */
export const PRODUCT_REVIEWS_REVALIDATE_SECONDS = 60;

const REVIEWS_PATH = '/reviews';

export const reviewsApi = {
  mine: (caller: CallerContext) => callApi<MyReviews>('GET', `${REVIEWS_PATH}/mine`, caller),
  /** Keeps the refusal's message: two different 409s need telling apart. */
  create: (caller: CallerContext, input: NewReview) =>
    callApiExplained<MyReview>('POST', REVIEWS_PATH, caller, input),
};

export type ProductReviewsResult = { ok: true; page: ReviewPage } | { ok: false };

/**
 * The newest `pageSize` published reviews for a product. Public: no session is sent, so the
 * answer is the same for everyone and can be cached. A failure is a value the page shows.
 */
export const getProductReviews = cache(
  async (productId: string, pageSize: number): Promise<ProductReviewsResult> => {
    try {
      const query = new URLSearchParams({ page: '1', pageSize: String(pageSize) });
      const page = await getJson<ReviewPage>(
        `${serverApiBaseUrl()}${REVIEWS_PATH}/product/${encodeURIComponent(productId)}?${query}`,
        { next: { revalidate: PRODUCT_REVIEWS_REVALIDATE_SECONDS } },
      );
      return { ok: true, page };
    } catch (error) {
      console.error('Product reviews could not be loaded', error);
      return { ok: false };
    }
  },
);

export type MyReviewsResult = { ok: true; mine: MyReviews } | { ok: false };

/** The signed-in customer's reviews and what still awaits one; `ok: false` signed out or on failure. */
export const getMyReviews = cache(async (): Promise<MyReviewsResult> => {
  const caller = await accountCaller();
  if (!caller) {
    return { ok: false };
  }
  const result = await reviewsApi.mine(caller);
  return result.ok ? { ok: true, mine: result.data } : { ok: false };
});

'use server';

import { getLocale } from 'next-intl/server';

import { redirect } from '../../i18n/navigation';
import { accountCaller } from '../account/caller';
import { ROUTES } from '../routes';
import { reviewsApi } from './api';
import { checkReview, REVIEW_SENT_PARAM, type ReviewFormError, reviewErrorOf } from './rules';

export type ReviewFormState =
  { status: 'idle' } | { status: 'error'; error: ReviewFormError; at: number };

/**
 * A trimmed field with its line breaks as `\n`. Browsers send a textarea's breaks as `\r\n`,
 * which would count twice against the API's length limit while the form's counter saw one.
 */
const field = (form: FormData, name: string): string =>
  String(form.get(name) ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();

const reviewError = (error: ReviewFormError): ReviewFormState => ({
  status: 'error',
  error,
  at: Date.now(),
});

/**
 * Sends a review of one delivered line. On success the page is loaded again with a thank-you,
 * which also moves the product from "waiting" to the customer's own reviews. Empty title and
 * text are left out: the API stores what it is sent.
 */
export async function submitReviewAction(
  _prev: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  const input = {
    orderItemId: field(form, 'orderItemId'),
    rating: Number.parseInt(field(form, 'rating'), 10),
    title: field(form, 'title'),
    body: field(form, 'body'),
  };
  const invalid = checkReview(input);
  if (invalid) {
    return reviewError(invalid);
  }
  const caller = await accountCaller();
  if (!caller) {
    return reviewError('signedOut');
  }
  const result = await reviewsApi.create(caller, {
    orderItemId: input.orderItemId,
    rating: input.rating,
    ...(input.title ? { title: input.title } : {}),
    ...(input.body ? { body: input.body } : {}),
  });
  if (!result.ok) {
    return reviewError(reviewErrorOf(result.status, result.message));
  }
  return redirect({
    href: { pathname: ROUTES.reviews, query: { [REVIEW_SENT_PARAM]: '1' } },
    locale: await getLocale(),
  });
}

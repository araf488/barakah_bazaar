// What the review form checks before a round trip, and how it reads the API's refusals.

/** Mirror `ReviewConstants` in the API (src/modules/review/review.constants.ts). */
export const REVIEW_MIN_RATING = 1;
export const REVIEW_MAX_RATING = 5;
export const REVIEW_TITLE_MAX_LENGTH = 120;
export const REVIEW_BODY_MAX_LENGTH = 2000;
/** The API's `MaxPageSize`: the most reviews one product page can ask for. */
export const REVIEW_MAX_PAGE_SIZE = 100;

/** Reviews the product page shows at first, and how many more each "show more" adds. */
export const REVIEWS_PER_STEP = 6;

/** The query flag the reviews page reads to thank the customer after a review is sent. */
export const REVIEW_SENT_PARAM = 'sent';

/** Every rating a customer can give, lowest first. */
export const RATINGS: readonly number[] = Array.from(
  { length: REVIEW_MAX_RATING - REVIEW_MIN_RATING + 1 },
  (_, index) => REVIEW_MIN_RATING + index,
);

/** Message keys under `myReviews.form.errors`. */
export type ReviewFormError =
  | 'ratingMissing'
  | 'titleLong'
  | 'bodyLong'
  | 'notReceived'
  | 'notDelivered'
  | 'alreadyReviewed'
  | 'invalid'
  | 'signedOut'
  | 'tooMany'
  | 'failed';

export interface ReviewInput {
  orderItemId: string;
  /** `NaN` when nothing was chosen. */
  rating: number;
  title: string;
  body: string;
}

/** The first problem the form can see by itself, or `null` to send it. */
export const checkReview = (input: ReviewInput): ReviewFormError | null => {
  if (
    !input.orderItemId ||
    !Number.isInteger(input.rating) ||
    input.rating < REVIEW_MIN_RATING ||
    input.rating > REVIEW_MAX_RATING
  ) {
    return input.orderItemId ? 'ratingMissing' : 'invalid';
  }
  if (input.title.length > REVIEW_TITLE_MAX_LENGTH) {
    return 'titleLong';
  }
  return input.body.length > REVIEW_BODY_MAX_LENGTH ? 'bodyLong' : null;
};

/**
 * `ReviewMessages` in the API: its two 409s mean different things to the customer, and only the
 * message tells them apart.
 */
const CONFLICT_MESSAGES: Readonly<Record<string, ReviewFormError>> = {
  'You can review this once it has been delivered.': 'notDelivered',
  'You have already reviewed this item.': 'alreadyReviewed',
};

const STATUS_ERRORS: Readonly<Record<number, ReviewFormError>> = {
  400: 'invalid',
  401: 'signedOut',
  404: 'notReceived',
  429: 'tooMany',
};

const CONFLICT = 409;

/** An API refusal as a form error. */
export const reviewErrorOf = (status: number, message: string | null): ReviewFormError => {
  if (status === CONFLICT) {
    const known =
      message && Object.hasOwn(CONFLICT_MESSAGES, message) ? CONFLICT_MESSAGES[message] : null;
    return known ?? 'failed';
  }
  return STATUS_ERRORS[status] ?? 'failed';
};

/**
 * How many published reviews the product page asks for: `?reviews=` counts steps of six, so a
 * "show more" link works without JavaScript. Anything unreadable is the first step.
 */
export const reviewsToShow = (param: string | string[] | undefined): number => {
  const steps = Number.parseInt(Array.isArray(param) ? (param[0] ?? '') : (param ?? ''), 10);
  const safeSteps = Number.isInteger(steps) && steps > 1 ? steps : 1;
  return Math.min(safeSteps * REVIEWS_PER_STEP, REVIEW_MAX_PAGE_SIZE);
};

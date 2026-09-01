export const ReviewConstants = {
  RouteBase: 'reviews',
  AdminRouteBase: 'admin/reviews',
  ResourceName: 'Review',
  MinRating: 1,
  MaxRating: 5,
  MaxTitleLength: 120,
  MaxBodyLength: 2000,
  MaxModerationNoteLength: 500,
  DefaultPageSize: 20,
  MaxPageSize: 100,
} as const;

export const ReviewMessages = {
  /** The order line does not exist, or does not belong to the caller. */
  LineNotFound: 'You can only review something you have received.',
  /** The order has not been delivered yet. */
  NotDelivered: 'You can review this once it has been delivered.',
  /** A second review on the same line. */
  AlreadyReviewed: 'You have already reviewed this item.',
  /** Moderating a review that is not waiting for it. */
  NotPending: 'This review has already been moderated.',
  /** The database could not be read or written. */
  Unavailable: 'Could not save your review. Please try again.',
  /** Recomputing the product rating failed, so the publish was rolled back. */
  RatingUpdateFailed: 'Could not update the product rating, so the review was not published.',
} as const;

/**
 * User-facing message contract. These strings reach the storefront, the admin
 * portal and the Flutter app, so treat a change here as an API change.
 *
 * Tests assert the literal expected string, never these constants.
 */
export const ErrorMessages = {
  /** Returned when the Authorization header is absent or malformed. */
  MissingAccessToken: 'Authentication is required to access this resource.',
  /** Returned when a token fails signature, audience or expiry verification. */
  InvalidAccessToken: 'Your session is invalid or has expired. Please sign in again.',
  /** Returned when JWT verification is not configured on the server. */
  AuthenticationUnavailable: 'Authentication is temporarily unavailable. Please try again later.',
  /** Returned when an authenticated user lacks the role a route requires. */
  InsufficientPermission: 'You do not have permission to perform this action.',
  /** Returned when the caller's local user record is disabled. */
  AccountDisabled: 'This account has been disabled. Please contact support.',
  /** Catch-all for an unhandled server fault. Never leaks internal detail. */
  UnexpectedError: 'Something went wrong on our end. Please try again.',
  /** Returned when a read fails because the database is unreachable. */
  ServiceUnavailable: 'The service is temporarily unavailable. Please try again shortly.',
  /** Returned when request validation rejects the payload. */
  ValidationFailed: 'The request contains invalid or missing fields.',
  /**
   * Returned when a caller exceeds a rate-limit bucket. One wording for every bucket,
   * because the throttler reports which limit was hit to the guard but not to the message —
   * naming the bucket would also tell an attacker which defence they tripped.
   */
  TooManyRequests: 'Too many requests. Please wait a moment and try again.',
} as const;

/** Templates consumed via `string.Format`-style substitution. */
export const ErrorMessageTemplates = {
  /** {0} = resource name, e.g. "Product". */
  NotFound: '{0} was not found.',
} as const;

/** Substitutes positional `{0}`, `{1}`… placeholders in a message template. */
export const formatMessage = (template: string, ...values: readonly string[]): string =>
  values.reduce((result, value, index) => result.split(`{${index}}`).join(value), template);

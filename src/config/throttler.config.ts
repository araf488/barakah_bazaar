import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { ErrorMessages } from '../common/constants/error-messages.constants';
import { optsIntoRateLimit } from '../common/decorators/rate-limit.decorator';
import { Env } from './env.schema';

/** Only the fields the throttler config needs, so callers can pass a ConfigService read. */
export type ThrottlerEnv = Pick<
  Env,
  'GEOCODING_RATE_LIMIT' | 'AUTH_RATE_LIMIT' | 'WRITE_RATE_LIMIT'
>;

/** Every named bucket below shares one window. */
const THROTTLE_WINDOW_MS = 60_000;

/** Methods that change nothing, so the write baseline ignores them. */
const READ_ONLY_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/** Named rate-limit buckets. A route joins one by asking for it with `@RateLimit(...)`. */
export const ThrottleBuckets = {
  /** Credential-checking endpoints — login, MFA verification, refresh — against brute force. */
  Auth: 'auth',
  /** The outbound map-search proxies. */
  Geocoding: 'geocoding',
  /** Baseline for every state-changing request; the one bucket no route has to ask for. */
  Writes: 'writes',
} as const;

/**
 * One bucket that costs nothing on the routes that did not ask for it.
 *
 * `skipIf` is what makes a bucket opt-in. Without it the globally registered guard applies
 * every bucket to every route (see `RateLimit`), so the strictest limit configured anywhere
 * silently becomes the limit on the whole API.
 */
const optInBucket = (name: string, limit: number): ThrottlerOptions => ({
  name,
  ttl: THROTTLE_WINDOW_MS,
  limit,
  skipIf: (context) => !optsIntoRateLimit(context, name),
});

/** Whether this request only reads, and so falls outside the write baseline. */
const isReadOnly = (context: ExecutionContext): boolean => {
  const request = context.switchToHttp().getRequest<{ method?: string } | undefined>();
  return READ_ONLY_METHODS.includes((request?.method ?? '').toUpperCase());
};

/**
 * The one bucket that applies without being asked for: a ceiling on writes.
 *
 * Reads are exempt because they are the bulk of storefront traffic and the cheapest thing
 * the API does, while the abuse worth bounding — order spam, review flooding, repeated
 * credential changes — arrives as writes. A route needing to sit outside even this (a
 * payment webhook taking a provider's retry burst, say) opts out with the library's own
 * `@SkipThrottle({ writes: true })`, which the guard honours ahead of `skipIf`.
 */
const writeBaselineBucket = (limit: number): ThrottlerOptions => ({
  name: ThrottleBuckets.Writes,
  ttl: THROTTLE_WINDOW_MS,
  limit,
  skipIf: isReadOnly,
});

/**
 * Named rate-limit buckets, registered for the globally applied guard (see
 * `AuthThrottlerGuard`). `geocoding` and `auth` apply only to the routes carrying
 * `@RateLimit` for them; `writes` applies to every state-changing request.
 *
 * A `@RateLimit('x')` decorator does nothing unless a bucket named `x` is registered here —
 * this is that registration.
 *
 * A write route that also names a bucket is subject to both, and the tighter one decides:
 * login is a POST, so it sits in `writes` (60/min) and `auth` (10/min) at once and is held
 * to 10. Each bucket counts per endpoint per caller, not across the API.
 */
export const buildThrottlerOptions = (env: ThrottlerEnv): ThrottlerModuleOptions => ({
  throttlers: [
    optInBucket(ThrottleBuckets.Geocoding, env.GEOCODING_RATE_LIMIT),
    optInBucket(ThrottleBuckets.Auth, env.AUTH_RATE_LIMIT),
    writeBaselineBucket(env.WRITE_RATE_LIMIT),
  ],
  // The object form rather than a bare array purely so this is honoured: the library reads
  // `errorMessage` only when the options are not an array, and its own default renders as
  // "ThrottlerException: Too Many Requests" — a class name in a client-facing message.
  errorMessage: ErrorMessages.TooManyRequests,
});

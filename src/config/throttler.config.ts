import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { ErrorMessages } from '../common/constants/error-messages.constants';
import { optsIntoRateLimit } from '../common/decorators/rate-limit.decorator';
import { Env } from './env.schema';

/** Only the fields the throttler config needs, so callers can pass a ConfigService read. */
export type ThrottlerEnv = Pick<
  Env,
  'GEOCODING_RATE_LIMIT' | 'AUTH_RATE_LIMIT' | 'AUTH_ACCOUNT_RATE_LIMIT' | 'WRITE_RATE_LIMIT'
>;

/** Every named bucket below shares one window. */
const THROTTLE_WINDOW_MS = 60_000;

/** Methods that change nothing, so the write baseline ignores them. */
const READ_ONLY_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Named rate-limit buckets. A route joins one or more by asking for them with
 * `@RateLimit(...)`.
 *
 * Login, MFA verification and refresh carry both `AuthIp` and `AuthAccount` together: a
 * single concatenated `ip|email` tracker (the previous design) combines the two properties'
 * *strings* rather than their protections — a hundred IPs attacking one account each land in
 * their own combined-key bucket of ten attempts, and a single IP trying a hundred accounts
 * does too. Two buckets, each with its own tracker, give each property its own count.
 */
export const ThrottleBuckets = {
  /** Credential-checking endpoints, keyed by the caller's IP — bounds brute force from one source. */
  AuthIp: 'auth-ip',
  /**
   * The same endpoints, keyed by the submitted email — bounds a distributed attempt against
   * one account spread across many IPs, which `AuthIp` alone cannot see.
   */
  AuthAccount: 'auth-account',
  /** The outbound map-search proxies. */
  Geocoding: 'geocoding',
  /** Baseline for every state-changing request; the one bucket no route has to ask for. */
  Writes: 'writes',
} as const;

/** Shape of the parsed JSON body on a credential route, once the pipeline has run. */
interface CredentialRequestBody {
  email?: unknown;
}

/**
 * The submitted email, lower-cased so a case variation cannot dodge the per-account bucket,
 * or `''` when the body carries none.
 */
const emailFromBody = (body: unknown): string => {
  const email = (body as CredentialRequestBody | undefined)?.email;
  return typeof email === 'string' ? email.toLowerCase() : '';
};

/** Whether the current request's body carries an email to key the account bucket on. */
const requestHasEmail = (context: ExecutionContext): boolean => {
  const request = context.switchToHttp().getRequest<{ body?: unknown } | undefined>();
  return emailFromBody(request?.body) !== '';
};

/** The caller's IP, or `''` on a request shape that carries none. */
const ipFromRequest = (req: unknown): string => (req as { ip?: string } | undefined)?.ip ?? '';

/**
 * One bucket that costs nothing on the routes that did not ask for it.
 *
 * `skipIf` is what makes a bucket opt-in. Without it the globally registered guard applies
 * every bucket to every route (see `RateLimit`), so the strictest limit configured anywhere
 * silently becomes the limit on the whole API. `getTracker` is set explicitly, rather than
 * left to the guard's own IP default, so this bucket's tracking is correct on its own terms
 * regardless of which guard class ends up registered globally — used for both this bucket
 * and `AuthIp`.
 */
const optInBucket = (name: string, limit: number): ThrottlerOptions => ({
  name,
  ttl: THROTTLE_WINDOW_MS,
  limit,
  skipIf: (context) => !optsIntoRateLimit(context, name),
  getTracker: ipFromRequest,
});

/**
 * A bucket keyed by the submitted email instead of the caller's IP, so a distributed attempt
 * against one account from many IPs is bounded even though each IP alone stays under
 * `AuthIp`'s per-IP limit.
 *
 * Skips both when the route did not ask for this bucket and when the request has no email to
 * key on — without the second check, every such request would share one `''` key and throttle
 * each other, which is not a protection this bucket is meant to provide.
 */
const optInAccountBucket = (name: string, limit: number): ThrottlerOptions => ({
  name,
  ttl: THROTTLE_WINDOW_MS,
  limit,
  skipIf: (context) => !optsIntoRateLimit(context, name) || !requestHasEmail(context),
  getTracker: (req) => emailFromBody((req as { body?: unknown }).body),
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
 * `AuthThrottlerGuard`). `geocoding`, `auth-ip` and `auth-account` apply only to the routes
 * carrying `@RateLimit` for them; `writes` applies to every state-changing request.
 *
 * A `@RateLimit('x')` decorator does nothing unless a bucket named `x` is registered here —
 * this is that registration.
 *
 * A write route that also names a bucket is subject to both, and the tighter one decides:
 * login is a POST, so it sits in `writes` (60/min) and `auth-ip` (10/min) at once and is held
 * to 10. Each bucket counts per endpoint per caller, not across the API.
 */
export const buildThrottlerOptions = (env: ThrottlerEnv): ThrottlerModuleOptions => ({
  throttlers: [
    optInBucket(ThrottleBuckets.Geocoding, env.GEOCODING_RATE_LIMIT),
    optInBucket(ThrottleBuckets.AuthIp, env.AUTH_RATE_LIMIT),
    optInAccountBucket(ThrottleBuckets.AuthAccount, env.AUTH_ACCOUNT_RATE_LIMIT),
    writeBaselineBucket(env.WRITE_RATE_LIMIT),
  ],
  // The object form rather than a bare array purely so this is honoured: the library reads
  // `errorMessage` only when the options are not an array, and its own default renders as
  // "ThrottlerException: Too Many Requests" — a class name in a client-facing message.
  errorMessage: ErrorMessages.TooManyRequests,
});

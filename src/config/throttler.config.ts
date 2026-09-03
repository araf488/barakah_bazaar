import { ThrottlerOptions } from '@nestjs/throttler';
import { Env } from './env.schema';

/** Only the fields the throttler config needs, so callers can pass a ConfigService read. */
export type ThrottlerEnv = Pick<Env, 'GEOCODING_RATE_LIMIT' | 'AUTH_RATE_LIMIT'>;

/** Every named bucket below shares one window. */
const THROTTLE_WINDOW_MS = 60_000;

/**
 * Named rate-limit buckets, checked for every request by the globally registered guard
 * (see `AuthThrottlerGuard`) unless a route opts out with `@SkipThrottle`.
 *
 * `geocoding` guards the outbound map-search proxies; `auth` guards the credential-checking
 * endpoints (login, MFA verification) against brute force. A `@Throttle({ auth: ... })`
 * decorator does nothing unless a bucket of that name is registered here — this is that
 * registration.
 */
export const buildThrottlerOptions = (env: ThrottlerEnv): ThrottlerOptions[] => [
  { name: 'geocoding', ttl: THROTTLE_WINDOW_MS, limit: env.GEOCODING_RATE_LIMIT },
  { name: 'auth', ttl: THROTTLE_WINDOW_MS, limit: env.AUTH_RATE_LIMIT },
];

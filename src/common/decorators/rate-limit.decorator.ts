import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { MetadataKeys } from '../constants/app.constants';

/**
 * Opts a route into one or more named rate-limit buckets.
 *
 * Buckets are opt-in here, which is the reverse of what `@nestjs/throttler` does unaided:
 * its guard walks *every* registered bucket on *every* request and skips one only where the
 * route carries `@SkipThrottle` for that name. Registering `auth` therefore capped all
 * traffic at `AUTH_RATE_LIMIT`, and `@Throttle({ auth: {} })` on login changed nothing —
 * an override with no values falls back to the same global limit it was already using.
 *
 * Each bucket's `skipIf` (see `buildThrottlerOptions`) consults this metadata instead, so a
 * bucket applies exactly where a route asks for it and nowhere else.
 *
 * @example `@RateLimit(ThrottleBuckets.Auth)`
 */
export const RateLimit = (...buckets: readonly string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(MetadataKeys.RateLimitBuckets, buckets);

/** Buckets declared on one reflection target — a route handler or its controller class. */
const declaredOn = (target: object | undefined): readonly string[] => {
  if (!target) {
    return [];
  }
  const buckets = Reflect.getMetadata(MetadataKeys.RateLimitBuckets, target) as
    readonly string[] | undefined;
  return buckets ?? [];
};

/**
 * Whether the route being handled opted into `bucket`, on the handler or on its controller.
 *
 * A bare `Reflect` read rather than a `Reflector`, because a throttler `skipIf` is handed
 * only an `ExecutionContext` and has nowhere to inject one.
 */
export const optsIntoRateLimit = (context: ExecutionContext, bucket: string): boolean =>
  declaredOn(context.getHandler()).includes(bucket) ||
  declaredOn(context.getClass()).includes(bucket);

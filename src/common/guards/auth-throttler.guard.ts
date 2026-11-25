import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/** Standard header a client reads to learn how long to wait. */
const RETRY_AFTER_HEADER = 'Retry-After';

/**
 * Registered as the sole global throttler guard (see `app.module.ts`).
 *
 * Tracking is no longer done here: each named bucket in `throttler.config.ts` carries its own
 * `getTracker` — `auth-ip` and `geocoding` by an explicit per-bucket IP reader, `auth-account`
 * by the submitted email, and `writes` (which sets none) by the library's own IP default. A
 * single concatenated `ip|email` key (this class's previous approach) combines the two
 * properties' *strings*, not their protections: a hundred IPs attacking one account still land
 * in a hundred separate combined-key buckets, and a single IP trying a hundred accounts does
 * too. Splitting into two buckets, each with its own tracker, is what actually bounds each
 * property (see `throttler.config.ts`'s `optInAccountBucket`).
 *
 * What this class still does is fix the library's `Retry-After` header below — that has
 * nothing to do with tracking, so the guard survives even though `getTracker` no longer needs
 * an override here.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  /**
   * Adds the unsuffixed `Retry-After` before handing off to the library's own rejection.
   *
   * The library suffixes that header with the bucket name for every bucket but `default`, so
   * a 429 from the `writes` bucket arrives carrying only `Retry-After-writes`. A client
   * obeying the standard header sees nothing and retries immediately, which is the opposite
   * of what a rate limit is asking for. The suffixed header is left in place — it says which
   * bucket rejected the call, which is useful in a log.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    // getRequestResponse is typed Record<string, any>, so name the one method used here.
    const response = res as { header: (name: string, value: number) => void };
    response.header(RETRY_AFTER_HEADER, detail.timeToBlockExpire ?? detail.timeToExpire);

    return super.throwThrottlingException(context, detail);
  }
}

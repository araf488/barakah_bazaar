import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/** Standard header a client reads to learn how long to wait. */
const RETRY_AFTER_HEADER = 'Retry-After';

/**
 * Registered as the sole global throttler guard (see `app.module.ts`), replacing the library's
 * default so every named bucket — `geocoding` and `auth` alike — is tracked by this key rather
 * than by IP alone.
 *
 * Per-IP alone does nothing against a distributed attempt on one account, and per-email alone
 * does nothing against credential stuffing across many. The tracker combines both.
 *
 * Body-parsing middleware runs before guards in Nest, so `request.body` is populated here —
 * this is not the impossibility it first looks like.
 *
 * A route with no email in its body still gets a stable, IP-only key: `email` resolves to
 * `''`. That matters less than it looks, because buckets are opt-in (see `RateLimit`) — a
 * route that never asked for one is not counted at all, whatever its key would have been.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const body = (req.body ?? {}) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
    return Promise.resolve(`${req.ip as string}|${email}`);
  }

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

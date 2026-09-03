import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

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
 * A route with no email in its body (every route but login and MFA verification) still gets a
 * stable, IP-only key: `email` resolves to `''`, so the bucket behaves exactly as it did before
 * this guard replaced the library's default one.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const body = (req.body ?? {}) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
    return Promise.resolve(`${req.ip as string}|${email}`);
  }
}

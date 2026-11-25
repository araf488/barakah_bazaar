import { Prisma } from '../../../infra/prisma/prisma-client';

/** The three send limits, read from env by the caller. */
export interface PhoneLimits {
  readonly cooldownSeconds: number;
  readonly perNumberDaily: number;
  readonly globalDaily: number;
}

/** Whether a send may go ahead, and if not, why. */
export type LimitVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'cooldown'; readonly retryAfterSeconds: number }
  | { readonly kind: 'number-limit' }
  | { readonly kind: 'global-limit' };

interface SendCountsRow {
  readonly global_count: number;
  readonly number_count: number;
  readonly cooldown_remaining: number;
}

/**
 * Cooldown, per-number and global daily limits over both code tables.
 *
 * Runs inside the caller's transaction after a per-number advisory lock, so two concurrent
 * requests for one number cannot both read "no recent send". Every time comparison uses the
 * database clock. `phone` must already be normalised: two spellings of one number would
 * otherwise get separate counts.
 */
export class PhoneSendLimits {
  static async check(
    tx: Prisma.TransactionClient,
    phone: string,
    limits: PhoneLimits,
  ): Promise<LimitVerdict> {
    // $executeRaw, not $queryRaw: the function returns void, which adapter-pg cannot deserialise.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${phone}, 0))`;

    const rows = await tx.$queryRaw<SendCountsRow[]>`
      WITH sends AS (
        SELECT phone, created_at FROM phone_verifications WHERE created_at > now() - interval '24 hours'
        UNION ALL
        SELECT phone, created_at FROM phone_login_challenges WHERE created_at > now() - interval '24 hours'
      )
      SELECT
        count(*)::int AS global_count,
        (count(*) FILTER (WHERE phone = ${phone}))::int AS number_count,
        COALESCE(CEIL(EXTRACT(EPOCH FROM (
          max(created_at) FILTER (WHERE phone = ${phone}) + make_interval(secs => ${limits.cooldownSeconds}) - now()
        ))), 0)::int AS cooldown_remaining
      FROM sends`;

    return PhoneSendLimits.decide(rows[0], limits);
  }

  private static decide(row: SendCountsRow | undefined, limits: PhoneLimits): LimitVerdict {
    if (!row) return { kind: 'ok' };
    if (row.global_count >= limits.globalDaily) return { kind: 'global-limit' };
    if (row.cooldown_remaining > 0) {
      return { kind: 'cooldown', retryAfterSeconds: row.cooldown_remaining };
    }
    if (row.number_count >= limits.perNumberDaily) return { kind: 'number-limit' };
    return { kind: 'ok' };
  }
}

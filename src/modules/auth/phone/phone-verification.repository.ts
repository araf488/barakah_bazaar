import { Injectable, Inject } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaErrorCodes } from '../../../common/constants/app.constants';
import { Prisma, PhoneVerification } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuthConstants, AuthTokens } from '../auth.constants';
import { SessionCachePort } from '../sessions/session-cache.port';
import { LimitVerdict, PhoneLimits, PhoneSendLimits } from './phone-send-limits';

/** Outcome of `issue`: a stored code, or the limit that refused it. */
export type IssueResult = { readonly kind: 'issued' } | Exclude<LimitVerdict, { kind: 'ok' }>;

/** A verification issue can also be refused by the per-account daily limit. */
export type VerificationIssueResult = IssueResult | { readonly kind: 'account-limit' };

/** What `PhoneVerificationRepository.issue` stores. */
export interface NewPhoneVerification {
  readonly userId: string;
  readonly phone: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
}

/** Outcome of `confirm`. */
export type ConfirmResult =
  | { readonly kind: 'confirmed'; readonly fullName: string | null }
  | { readonly kind: 'already-used' }
  | { readonly kind: 'phone-in-use' };

/** Thrown inside the confirm transaction to roll it back when the code was already spent. */
class PhoneCodeAlreadyUsedError extends Error {}

/**
 * Reads and writes `phone_verifications`: codes proving a customer owns a number.
 *
 * Reads are three-valued: `null` is a database fault, `undefined` is no row, a value is the
 * row. Callers pass normalised phone numbers; nothing here normalises.
 */
@Injectable()
export class PhoneVerificationRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AuthTokens.SessionCache) private readonly sessionCache: SessionCachePort,
    @InjectPinoLogger(PhoneVerificationRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Checks the send limits, then the account's daily limit, retires the user's earlier live
   * codes, and stores the new one.
   */
  async issue(
    data: NewPhoneVerification,
    limits: PhoneLimits,
    accountDailyLimit: number,
  ): Promise<VerificationIssueResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const verdict = await PhoneSendLimits.check(tx, data.phone, limits);
        if (verdict.kind !== 'ok') return verdict;

        if (
          await PhoneVerificationRepository.lockedAccountLimitReached(
            tx,
            data.userId,
            accountDailyLimit,
          )
        ) {
          return { kind: 'account-limit' } as const;
        }

        await tx.phoneVerification.updateMany({
          where: { userId: data.userId, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        await tx.phoneVerification.create({ data });
        return { kind: 'issued' } as const;
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: data.userId },
        'Exception occurred in PhoneVerificationRepository.issue',
      );
      return null;
    }
  }

  /**
   * A lock-free peek at whether the account has already spent its daily sends: the same 24 h
   * count on the database clock as the one inside `issue`, but with no advisory lock and no
   * write. It lets the service refuse a capped account before any ownership lookup, so a capped
   * account cannot read "is this number registered?" off a 409. `issue` stays the race-safe
   * check. `null` on a fault.
   */
  async accountLimitReached(userId: string, perAccountDaily: number): Promise<boolean | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ account_count: number }[]>`
        SELECT count(*)::int AS account_count FROM phone_verifications
        WHERE user_id = ${userId}::uuid AND created_at > now() - interval '24 hours'`;
      return (rows[0]?.account_count ?? 0) >= perAccountDaily;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in PhoneVerificationRepository.accountLimitReached',
      );
      return null;
    }
  }

  async findNewestLive(
    userId: string,
    phone: string,
  ): Promise<PhoneVerification | null | undefined> {
    try {
      const row = await this.prisma.phoneVerification.findFirst({
        where: { userId, phone, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return row ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in PhoneVerificationRepository.findNewestLive',
      );
      return null;
    }
  }

  /**
   * Claims one guess against the code before it is compared, atomically. `true` only while
   * the code is unspent and under the attempt cap, so a concurrent burst cannot out-guess it;
   * `null` on a write fault.
   */
  async claimAttempt(id: string): Promise<boolean | null> {
    try {
      const claimed = await this.prisma.phoneVerification.updateMany({
        where: {
          id,
          consumedAt: null,
          attempts: { lt: AuthConstants.PhoneCodeMaxAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      return claimed.count === 1;
    } catch (error) {
      this.logger.error(
        { err: error, verificationId: id },
        'Exception occurred in PhoneVerificationRepository.claimAttempt',
      );
      return null;
    }
  }

  /**
   * Spends the code and writes the verified number onto the user, in one transaction. The
   * conditional update is the guard: of two concurrent confirms only one sees a count of 1.
   */
  async confirm(id: string, userId: string, phone: string): Promise<ConfirmResult | null> {
    let result: ConfirmResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const spent = await tx.phoneVerification.updateMany({
          where: { id, consumedAt: null },
          data: { consumedAt: now },
        });
        if (spent.count === 0) throw new PhoneCodeAlreadyUsedError();

        // The name greets the owner in the linked-number email; read here, in the read this
        // transaction already makes, rather than in a second query afterwards.
        const owner = await tx.user.findUnique({
          where: { id: userId },
          select: { fullName: true },
        });
        await tx.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: now } });
        return { kind: 'confirmed', fullName: owner?.fullName ?? null } as const;
      });
    } catch (error) {
      return this.confirmFailure(error, userId);
    }

    await this.invalidateCache(userId);
    return result;
  }

  /** Removes finished rows older than `before`. Live rows are never touched. */
  async deleteStale(before: Date): Promise<number | null> {
    try {
      const result = await this.prisma.phoneVerification.deleteMany({
        where: {
          createdAt: { lt: before },
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
        },
      });
      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PhoneVerificationRepository.deleteStale',
      );
      return null;
    }
  }

  /**
   * Whether this account has had `limit` verification codes in the last 24 hours, on the
   * database clock.
   *
   * Serialised by a second advisory lock, on the user id. The per-number lock does not cover
   * this count: two requests from one account for two different numbers take two different
   * number locks, so without this one both could read 4 and both insert, ending at 6. The
   * account lock is always taken after the number lock, and nothing takes a number lock while
   * holding an account lock, so the two cannot deadlock. The lock is released at commit, after
   * the insert, so the next request's count includes this one's row.
   */
  private static async lockedAccountLimitReached(
    tx: Prisma.TransactionClient,
    userId: string,
    limit: number,
  ): Promise<boolean> {
    // $executeRaw, not $queryRaw: the function returns void, which adapter-pg cannot deserialise.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
    const rows = await tx.$queryRaw<{ account_count: number }[]>`
      SELECT count(*)::int AS account_count FROM phone_verifications
      WHERE user_id = ${userId}::uuid AND created_at > now() - interval '24 hours'`;
    return (rows[0]?.account_count ?? 0) >= limit;
  }

  private confirmFailure(error: unknown, userId: string): ConfirmResult | null {
    if (error instanceof PhoneCodeAlreadyUsedError) return { kind: 'already-used' };

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCodes.UniqueConstraint
    ) {
      this.logger.info({ userId }, 'Phone confirm found the number on another account');
      return { kind: 'phone-in-use' };
    }

    this.logger.error(
      { err: error, userId },
      'Exception occurred in PhoneVerificationRepository.confirm',
    );
    return null;
  }

  /** The write is committed; a failed cache bump only delays the cached view. */
  private async invalidateCache(userId: string): Promise<void> {
    try {
      await this.sessionCache.invalidateUser(userId);
    } catch (error) {
      this.logger.warn(
        { err: error, userId },
        'Session cache invalidation failed after phone confirm',
      );
    }
  }
}

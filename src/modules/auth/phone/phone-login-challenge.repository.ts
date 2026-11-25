import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PhoneLoginChallenge, User } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuthConstants } from '../auth.constants';
import { IssueResult } from './phone-verification.repository';
import { PhoneLimits, PhoneSendLimits } from './phone-send-limits';

/** What `PhoneLoginChallengeRepository.issue` stores. */
export interface NewPhoneLoginChallenge {
  readonly userId: string;
  readonly phone: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
}

/** A challenge joined to the account it would sign in. */
export type PhoneLoginChallengeWithUser = PhoneLoginChallenge & { user: User };

/**
 * Reads and writes `phone_login_challenges`: codes that sign a customer in by number.
 *
 * Same three-valued reads as `PhoneVerificationRepository`; callers pass normalised numbers.
 */
@Injectable()
export class PhoneLoginChallengeRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PhoneLoginChallengeRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Whether the daily SMS ceiling is already spent, counted over both code tables on the
   * database clock. `null` on a fault. It depends on no number, so the answer cannot reveal
   * whether any account exists.
   */
  async globalLimitReached(globalDaily: number): Promise<boolean | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ global_count: number }[]>`
        WITH sends AS (
          SELECT created_at FROM phone_verifications WHERE created_at > now() - interval '24 hours'
          UNION ALL
          SELECT created_at FROM phone_login_challenges WHERE created_at > now() - interval '24 hours'
        )
        SELECT count(*)::int AS global_count FROM sends`;
      return (rows[0]?.global_count ?? 0) >= globalDaily;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PhoneLoginChallengeRepository.globalLimitReached',
      );
      return null;
    }
  }

  /** Checks the send limits, retires the user's earlier live challenges, stores the new one. */
  async issue(data: NewPhoneLoginChallenge, limits: PhoneLimits): Promise<IssueResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const verdict = await PhoneSendLimits.check(tx, data.phone, limits);
        if (verdict.kind !== 'ok') return verdict;

        await tx.phoneLoginChallenge.updateMany({
          where: { userId: data.userId, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        await tx.phoneLoginChallenge.create({ data });
        return { kind: 'issued' } as const;
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: data.userId },
        'Exception occurred in PhoneLoginChallengeRepository.issue',
      );
      return null;
    }
  }

  async findNewestLiveForPhone(
    phone: string,
  ): Promise<PhoneLoginChallengeWithUser | null | undefined> {
    try {
      const row = await this.prisma.phoneLoginChallenge.findFirst({
        where: { phone, consumedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      });
      return row ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PhoneLoginChallengeRepository.findNewestLiveForPhone',
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
      const claimed = await this.prisma.phoneLoginChallenge.updateMany({
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
        { err: error, challengeId: id },
        'Exception occurred in PhoneLoginChallengeRepository.claimAttempt',
      );
      return null;
    }
  }

  /** Spends the challenge. `true` only for the one caller that won; `null` on a write fault. */
  async consume(id: string): Promise<boolean | null> {
    try {
      const result = await this.prisma.phoneLoginChallenge.updateMany({
        where: { id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return result.count === 1;
    } catch (error) {
      this.logger.error(
        { err: error, challengeId: id },
        'Exception occurred in PhoneLoginChallengeRepository.consume',
      );
      return null;
    }
  }

  /** Removes finished rows older than `before`. Live rows are never touched. */
  async deleteStale(before: Date): Promise<number | null> {
    try {
      const result = await this.prisma.phoneLoginChallenge.deleteMany({
        where: {
          createdAt: { lt: before },
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
        },
      });
      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PhoneLoginChallengeRepository.deleteStale',
      );
      return null;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EmailVerification, User } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/** A verification row joined to the account it belongs to. */
export type EmailVerificationWithUser = EmailVerification & { user: User };

/** What `create` needs. */
export interface NewEmailVerification {
  readonly userId: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
}

/**
 * Reads and writes `email_verifications`.
 *
 * Reads are three-valued exactly as `AuthRepository`'s are: `null` is "the database could not
 * answer", `undefined` is "no such row", a value is the row. Collapsing the first two would
 * turn an outage into "that link is not valid", which sends people to request another.
 */
@Injectable()
export class EmailVerificationRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(EmailVerificationRepository.name) private readonly logger: PinoLogger,
  ) {}

  async create(data: NewEmailVerification): Promise<EmailVerification | null> {
    try {
      return await this.prisma.emailVerification.create({
        data: { ...data, email: data.email.toLowerCase() },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: data.userId },
        'Exception occurred in EmailVerificationRepository.create',
      );
      return null;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<EmailVerificationWithUser | null | undefined> {
    try {
      const row = await this.prisma.emailVerification.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      return row ?? undefined;
    } catch (error) {
      // No hash in the line: it is half of a live credential.
      this.logger.error(
        { err: error },
        'Exception occurred in EmailVerificationRepository.findByTokenHash',
      );
      return null;
    }
  }

  async findNewestLiveForEmail(
    email: string,
  ): Promise<EmailVerificationWithUser | null | undefined> {
    try {
      const row = await this.prisma.emailVerification.findFirst({
        where: { email: email.toLowerCase(), consumedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      });

      return row ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in EmailVerificationRepository.findNewestLiveForEmail',
      );
      return null;
    }
  }

  /**
   * Atomically increments the failed-attempt counter and returns the new count.
   *
   * `data: { attempts: { increment: 1 } }` is a database-side atomic increment: two concurrent
   * wrong guesses each add 1 to whatever the column currently holds, rather than one racing the
   * other's read of a value computed in the caller. A caller-computed `attempts + 1` can lose
   * updates under concurrency — two guesses reading the same stale count both write the same
   * next value, and the attempt cap advances by one for every two guesses instead of every one.
   *
   * `null` only on a write fault, so the caller can fail closed — a guess must not be allowed
   * through just because the counter could not be confirmed.
   */
  async incrementAttempts(id: string): Promise<number | null> {
    try {
      const updated = await this.prisma.emailVerification.update({
        where: { id },
        data: { attempts: { increment: 1 } },
      });
      return updated.attempts;
    } catch (error) {
      this.logger.error(
        { err: error, verificationId: id },
        'Exception occurred in EmailVerificationRepository.incrementAttempts',
      );
      return null;
    }
  }

  /** Closes every live record for the account. Returns the count, or `null` if the write failed. */
  async consumeAllForUser(userId: string): Promise<number | null> {
    try {
      const result = await this.prisma.emailVerification.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in EmailVerificationRepository.consumeAllForUser',
      );
      return null;
    }
  }

  /** Removes finished rows older than `before`. Live rows are never touched. */
  async deleteStale(before: Date): Promise<number | null> {
    try {
      const result = await this.prisma.emailVerification.deleteMany({
        where: {
          createdAt: { lt: before },
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
        },
      });

      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in EmailVerificationRepository.deleteStale',
      );
      return null;
    }
  }
}

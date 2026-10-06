import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PasswordReset, User } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/** A reset row joined to the account it belongs to. */
export type PasswordResetWithUser = PasswordReset & { user: User };

/** What `create` needs. */
export interface NewPasswordReset {
  readonly userId: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
}

/**
 * Reads and writes `password_resets`.
 *
 * The same shape as `EmailVerificationRepository`, over a separate table on purpose. See the
 * model's comment in `schema.prisma`. Reads are three-valued: `null` is "the database could
 * not answer", `undefined` is "no such row". Collapsing them would turn an outage into "that
 * link is not valid", which sends people to request another during the outage.
 *
 * No hash ever appears in a log line here: each one is half of a live account-takeover
 * credential.
 */
@Injectable()
export class PasswordResetRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PasswordResetRepository.name) private readonly logger: PinoLogger,
  ) {}

  async create(data: NewPasswordReset): Promise<PasswordReset | null> {
    try {
      return await this.prisma.passwordReset.create({
        data: { ...data, email: data.email.toLowerCase() },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: data.userId },
        'Exception occurred in PasswordResetRepository.create',
      );
      return null;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetWithUser | null | undefined> {
    try {
      const row = await this.prisma.passwordReset.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      return row ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PasswordResetRepository.findByTokenHash',
      );
      return null;
    }
  }

  /** Filters on `email`, served by the `(email, created_at)` index. */
  async findNewestLiveForEmail(email: string): Promise<PasswordResetWithUser | null | undefined> {
    try {
      const row = await this.prisma.passwordReset.findFirst({
        where: { email: email.toLowerCase(), consumedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      });

      return row ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PasswordResetRepository.findNewestLiveForEmail',
      );
      return null;
    }
  }

  /**
   * Atomically increments the failed-attempt counter and returns the new count.
   *
   * A database-side `increment`, never a caller-computed `attempts + 1`. Sub-project 2 first
   * shipped the read-then-write form, and concurrent guesses lost updates: the cap advanced once
   * per several guesses. `null` only on a write fault, so the caller can fail closed.
   */
  async incrementAttempts(id: string): Promise<number | null> {
    try {
      const updated = await this.prisma.passwordReset.update({
        where: { id },
        data: { attempts: { increment: 1 } },
      });
      return updated.attempts;
    } catch (error) {
      this.logger.error(
        { err: error, passwordResetId: id },
        'Exception occurred in PasswordResetRepository.incrementAttempts',
      );
      return null;
    }
  }

  /**
   * Atomically takes one live record for a redemption in progress, by stamping `consumedAt`.
   *
   * A conditional write, never a read-then-write: of two concurrent redemptions of the same
   * record, exactly one matches `consumedAt: null` and the other matches nothing. Returns the
   * stamp written (the caller needs it to `release`), `undefined` when the record was already
   * taken or has expired, and `null` on a write fault.
   */
  async claim(id: string): Promise<Date | null | undefined> {
    try {
      const claimedAt = new Date();
      const result = await this.prisma.passwordReset.updateMany({
        where: { id, consumedAt: null, expiresAt: { gt: claimedAt } },
        data: { consumedAt: claimedAt },
      });

      return result.count === 1 ? claimedAt : undefined;
    } catch (error) {
      this.logger.error(
        { err: error, passwordResetId: id },
        'Exception occurred in PasswordResetRepository.claim',
      );
      return null;
    }
  }

  /**
   * Hands a claimed record back, so a redemption that failed after `claim` (a weak password, a
   * revocation that could not be confirmed) leaves the credential usable for the retry.
   *
   * Matched on the claim's own stamp, so it can only undo that claim and never reopens a record
   * something else has since consumed. Returns the count, or `null` if the write failed.
   */
  async release(id: string, claimedAt: Date): Promise<number | null> {
    try {
      const result = await this.prisma.passwordReset.updateMany({
        where: { id, consumedAt: claimedAt },
        data: { consumedAt: null },
      });

      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error, passwordResetId: id },
        'Exception occurred in PasswordResetRepository.release',
      );
      return null;
    }
  }

  /** Closes every live record for the account. Returns the count, or `null` if the write failed. */
  async consumeAllForUser(userId: string): Promise<number | null> {
    try {
      const result = await this.prisma.passwordReset.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in PasswordResetRepository.consumeAllForUser',
      );
      return null;
    }
  }

  /** Removes finished rows older than `before`. Live rows are never touched. */
  async deleteStale(before: Date): Promise<number | null> {
    try {
      const result = await this.prisma.passwordReset.deleteMany({
        where: {
          createdAt: { lt: before },
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
        },
      });

      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in PasswordResetRepository.deleteStale',
      );
      return null;
    }
  }
}

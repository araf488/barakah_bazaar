import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaErrorCodes } from '../../../common/constants/app.constants';
import { PasswordReset, Prisma, User } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuthConstants } from '../auth.constants';

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
   * Claims one guess against the code before it is compared, atomically, and returns the new
   * attempt count.
   *
   * One conditional `update`: `where` carries the unspent and under-the-cap predicates beside the
   * id, so the database matches and increments in a single statement. Concurrent guesses
   * serialise on the row, and only those that find `attempts < PasswordResetMaxAttempts` get a slot, so a burst cannot
   * out-guess the cap. The count comes back from that same statement, never from a second read
   * another guess could have moved. Prisma raises `P2025` when nothing matched, which is
   * `false`: the code is spent or out of attempts, not a fault.
   *
   * `null` on any other fault, so the caller can fail closed.
   */
  async claimAttempt(id: string): Promise<number | false | null> {
    try {
      const claimed = await this.prisma.passwordReset.update({
        where: {
          id,
          consumedAt: null,
          attempts: { lt: AuthConstants.PasswordResetMaxAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      return claimed.attempts;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCodes.RecordNotFound
      ) {
        return false;
      }
      this.logger.error(
        { err: error, passwordResetId: id },
        'Exception occurred in PasswordResetRepository.claimAttempt',
      );
      return null;
    }
  }

  /**
   * Gives back the guess slot a correct code claimed, when the redemption was refused for a
   * reason that is not a guess. Applies only to a still-unconsumed record with a slot to give
   * back (`attempts > 0`), so it can neither reopen a spent record nor push the count below zero.
   * Returns the count, or `null` if the write failed.
   */
  async refundAttempt(id: string): Promise<number | null> {
    try {
      const result = await this.prisma.passwordReset.updateMany({
        where: { id, consumedAt: null, attempts: { gt: 0 } },
        data: { attempts: { decrement: 1 } },
      });

      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error, passwordResetId: id },
        'Exception occurred in PasswordResetRepository.refundAttempt',
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
   * something else has since consumed. When `refundAttempt` is true the guess slot a correct
   * code claimed is given back in the same write (`attempts` decrement), so a refusal that was
   * not a guess costs no attempt; it is applied only to the record still carrying this claim.
   * Returns the count, or `null` if the write failed.
   */
  async release(id: string, claimedAt: Date, refundAttempt: boolean): Promise<number | null> {
    try {
      const result = await this.prisma.passwordReset.updateMany({
        where: { id, consumedAt: claimedAt },
        data: refundAttempt
          ? { consumedAt: null, attempts: { decrement: 1 } }
          : { consumedAt: null },
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

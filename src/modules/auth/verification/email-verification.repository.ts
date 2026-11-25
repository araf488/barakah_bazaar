import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaErrorCodes } from '../../../common/constants/app.constants';
import { EmailVerification, Prisma, User } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuthConstants } from '../auth.constants';

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
   * Claims one guess against the code before it is compared, atomically, and returns the new
   * attempt count.
   *
   * One conditional `update`: `where` carries the unspent and under-the-cap predicates beside the
   * id, so the database matches and increments in a single statement. Concurrent guesses
   * serialise on the row, and only those that find `attempts < EmailVerificationMaxAttempts` get a slot, so a burst cannot
   * out-guess the cap. The count comes back from that same statement, never from a second read
   * another guess could have moved. Prisma raises `P2025` when nothing matched, which is
   * `false`: the code is spent or out of attempts, not a fault.
   *
   * `null` on any other fault, so the caller can fail closed.
   */
  async claimAttempt(id: string): Promise<number | false | null> {
    try {
      const claimed = await this.prisma.emailVerification.update({
        where: {
          id,
          consumedAt: null,
          attempts: { lt: AuthConstants.EmailVerificationMaxAttempts },
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
        { err: error, verificationId: id },
        'Exception occurred in EmailVerificationRepository.claimAttempt',
      );
      return null;
    }
  }

  /**
   * Gives back the guess slot a correct code claimed, when verification then failed for a reason
   * that is not a guess. Applies only to a still-unconsumed record with a slot to give back
   * (`attempts > 0`). Returns the count, or `null` if the write failed.
   */
  async refundAttempt(id: string): Promise<number | null> {
    try {
      const result = await this.prisma.emailVerification.updateMany({
        where: { id, consumedAt: null, attempts: { gt: 0 } },
        data: { attempts: { decrement: 1 } },
      });

      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error, verificationId: id },
        'Exception occurred in EmailVerificationRepository.refundAttempt',
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

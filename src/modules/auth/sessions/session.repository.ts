import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaErrorCodes } from '../../../common/constants/app.constants';
import { Prisma, Session, User } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/**
 * A session with its owner attached.
 *
 * The guard and the refresh path both need `isActive` and `role` from the user in the same
 * breath as the session row, so every read that feeds an access decision brings the user
 * with it — one query, and no window in which the two were read at different moments.
 */
export type SessionWithUser = Session & { user: User };

/**
 * Everything a new session row records. `refreshTokenHash` is a hash, never a token:
 * nothing in this file ever accepts, returns or logs a raw refresh token.
 */
export interface SessionCreateData {
  userId: string;
  refreshTokenHash: string;
  /** Sliding idle deadline. */
  expiresAt: Date;
  /** Hard ceiling, never extended by a later rotation. */
  absoluteExpiresAt: Date;
  deviceId: string;
  userAgent: string | null;
  ipAddress: string | null;
}

/** What the client looked like on the request that rotated the token. */
export interface SessionSighting {
  userAgent: string | null;
  ipAddress: string | null;
}

/**
 * Session persistence: one row per signed-in device, keyed for lookup by the SHA-256 of its
 * refresh token.
 *
 * Reads are three-valued, per the repository contract: `null` means the read itself failed,
 * `undefined` means there is no such row. Collapsing them would answer "sign in again" to
 * every holder of a perfectly good session during a database outage — signing the whole user
 * base out because one query timed out.
 *
 * Writes return the row (or `null`) rather than throwing, so a database fault becomes a value
 * the service branches on instead of an unhandled 500 mid-authentication.
 */
@Injectable()
export class SessionRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SessionRepository.name) private readonly logger: PinoLogger,
  ) {}

  /** Writes a new session. `null` when the write failed. */
  async create(data: SessionCreateData): Promise<Session | null> {
    try {
      return await this.prisma.session.create({ data });
    } catch (error) {
      this.logger.error(
        { err: error, userId: data.userId },
        'Exception occurred in SessionRepository.create',
      );
      return null;
    }
  }

  /**
   * The session behind an access token's `sid` claim, with its owner.
   *
   * One query on purpose: the guard runs on every authenticated request, and a second round
   * trip to fetch the user would double that cost for no added certainty.
   */
  async findByIdWithUser(id: string): Promise<SessionWithUser | null | undefined> {
    try {
      return (
        (await this.prisma.session.findUnique({
          where: { id },
          include: { user: true },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, sessionId: id },
        'Exception occurred in SessionRepository.findByIdWithUser',
      );
      return null;
    }
  }

  /**
   * The session a presented refresh token belongs to, whether the hash is the session's
   * current one or the one it rotated away from.
   *
   * Two lookups rather than one `OR`, in that order, because both columns are unique
   * *separately*: a value that is current on one row and previous on another would make a
   * single `findFirst` non-deterministic about which row it returned. Current wins, always.
   *
   * The caller tells the two apart by comparing the presented hash with the row's
   * `refreshTokenHash` — a previous-hash match is either a concurrent refresh or a replay,
   * and only `previousRotatedAt` says which.
   *
   * The hash is never logged: it is the verifier for a live credential, and a log line
   * carrying it would let anyone with log access mint sessions.
   */
  async findByRefreshHash(hash: string): Promise<SessionWithUser | null | undefined> {
    try {
      const current = await this.prisma.session.findUnique({
        where: { refreshTokenHash: hash },
        include: { user: true },
      });

      if (current) {
        return current;
      }

      return (
        (await this.prisma.session.findUnique({
          where: { previousRefreshTokenHash: hash },
          include: { user: true },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in SessionRepository.findByRefreshHash',
      );
      return null;
    }
  }

  /**
   * Swaps in a new refresh hash, keeps `previousHash` as the one-step-back value and stamps
   * when that happened, then slides the idle deadline.
   *
   * `previousHash` is the hash being rotated *away from*, and it appears twice on purpose:
   * as the value stored in the previous slot, and as a condition on the write. That makes
   * this a compare-and-swap. Two requests that read the same generation of the token and
   * both reach this point would otherwise both rotate, and the token the loser already
   * returned to the client would be left resolving to nothing. With the condition, exactly
   * one rotation per generation succeeds and the loser writes nothing at all — its caller
   * hands out no token, and the client's retry finds the hash in the previous slot and is
   * served from the reuse grace window instead.
   *
   * `absoluteExpiresAt` is never touched. It is the ceiling, and a rotation that could raise
   * it would make an endlessly-refreshed session immortal.
   *
   * `revokedAt: null` is in the predicate too, not left to a check the caller made earlier:
   * a session revoked between the caller's guard and this write must not be handed a fresh
   * token. It fails the write instead — closed, not open.
   */
  async rotate(
    id: string,
    nextHash: string,
    previousHash: string,
    expiresAt: Date,
    sighting: SessionSighting,
  ): Promise<Session | null> {
    try {
      const rotatedAt = new Date();

      return await this.prisma.session.update({
        where: { id, refreshTokenHash: previousHash, revokedAt: null },
        data: {
          refreshTokenHash: nextHash,
          previousRefreshTokenHash: previousHash,
          previousRotatedAt: rotatedAt,
          expiresAt,
          lastUsedAt: rotatedAt,
          userAgent: sighting.userAgent,
          ipAddress: sighting.ipAddress,
        },
      });
    } catch (error) {
      if (SessionRepository.isLostConditionalWrite(error)) {
        // Not a fault, and classified before the catch-all so it cannot be filed as one: the
        // predicate carries `refreshTokenHash` and `revokedAt`, so no matching row means a
        // concurrent refresh lost the compare-and-swap or the session was revoked in the
        // meantime. Both happen by design, on every refresh race — logging them at `error`
        // with a stack trace would bury the rotation faults that genuinely need reading.
        this.logger.warn(
          { sessionId: id },
          'Session rotation matched no live row; no token was issued',
        );
        return null;
      }

      this.logger.error(
        { err: error, sessionId: id },
        'Exception occurred in SessionRepository.rotate',
      );
      return null;
    }
  }

  /**
   * A conditional write that matched no row.
   *
   * Prisma raises `P2025` both when the id does not exist and when the extra predicate did
   * not hold; for `rotate` the two mean the same thing — nothing was written, so nothing was
   * issued — and neither is a database fault.
   */
  private static isLostConditionalWrite(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCodes.RecordNotFound
    );
  }

  /**
   * Slides the idle deadline and records the sighting. Returns nothing, and swallows its own
   * failure by design: this is bookkeeping on a request that was otherwise fine, and failing
   * the request because a sliding-window update did not land would turn a write blip into a
   * sign-out. The next authenticated request tries again.
   */
  async touch(id: string, expiresAt: Date): Promise<void> {
    try {
      await this.prisma.session.update({
        where: { id, revokedAt: null },
        data: { expiresAt, lastUsedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        { err: error, sessionId: id },
        'Could not slide the session idle deadline; continuing',
      );
    }
  }

  /**
   * Ends one session.
   *
   * `true` means the session is not live afterwards — this call revoked it, or it was already
   * revoked, or there is no such row. All three leave the caller in the state it asked for.
   * `false` means the write failed and the session may still be live, which is the only
   * answer a caller must treat as a problem.
   *
   * `revokedAt: null` is in the predicate so the *first* revocation timestamp survives: when
   * a session was killed is what an investigation needs, and re-stamping it would erase that.
   */
  async revoke(id: string): Promise<boolean> {
    try {
      await this.prisma.session.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    } catch (error) {
      this.logger.error(
        { err: error, sessionId: id },
        'Exception occurred in SessionRepository.revoke',
      );
      return false;
    }
  }

  /**
   * Ends every live session a user has, and reports how many were still live.
   *
   * `null`, not `0`, when the write fails. "Signed everyone out, zero sessions affected" and
   * "the sign-out did not happen" are opposite facts, and a caller reading a password change
   * or a lockout as complete when nothing was written is precisely the fail-open this
   * distinction exists to prevent.
   */
  async revokeAllForUser(userId: string): Promise<number | null> {
    try {
      const result = await this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in SessionRepository.revokeAllForUser',
      );
      return null;
    }
  }

  /**
   * The user's live sessions, newest first, for the "where am I signed in" listing.
   *
   * "Live" here has to mean exactly what the session guard means by it, or the listing offers
   * a sign-out button for a session that is already dead. Both deadlines are therefore in the
   * predicate: `expiresAt` is capped at `absoluteExpiresAt` on every write, so the second
   * filter is redundant while that invariant holds — and it is the invariant, not the
   * arithmetic, that would be wrong if a row ever escaped it.
   */
  async listLiveForUser(userId: string): Promise<Session[] | null> {
    try {
      const now = new Date();

      return await this.prisma.session.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in SessionRepository.listLiveForUser',
      );
      return null;
    }
  }

  /**
   * Whether this account has any earlier session from this device — including revoked and
   * expired ones, because "have they signed in from here before" is a question about history,
   * not about what is live now.
   *
   * `exceptSessionId` is the session that asked, and excluding it is load-bearing: the caller
   * runs this *after* opening the new session, so without the exclusion every device would
   * find its own brand-new row and look familiar.
   *
   * `null` on failure, and the caller treats that as "cannot tell" rather than "new": a
   * database hiccup must not raise a new-device alert on a device the user has used for
   * months.
   */
  async hasDeviceHistory(
    userId: string,
    deviceId: string,
    exceptSessionId: string,
  ): Promise<boolean | null> {
    try {
      const existing = await this.prisma.session.findFirst({
        where: { userId, deviceId, id: { not: exceptSessionId } },
        select: { id: true },
      });

      return existing !== null;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in SessionRepository.hasDeviceHistory',
      );
      return null;
    }
  }

  /**
   * Deletes the recovery codes of accounts that are no longer enabled, and reports how many.
   *
   * A disabled account cannot sign in at all, so its unused codes are dead weight that is
   * still a live credential if the row leaks. Used codes go too: `used_at` records that a
   * code was spent, and the audit trail — not this table — is where that belongs long-term.
   */
  async deleteRecoveryCodesForDisabledUsers(): Promise<number | null> {
    try {
      const result = await this.prisma.mfaRecoveryCode.deleteMany({
        where: { user: { isActive: false } },
      });
      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in SessionRepository.deleteRecoveryCodesForDisabledUsers',
      );
      return null;
    }
  }

  /**
   * Removes rows whose hard ceiling has passed, and reports how many.
   *
   * Keyed on `absoluteExpiresAt`, not `expiresAt`: an idle-expired session is still a record
   * of a real sign-in until its ceiling passes, and support reads that. `null` on failure,
   * for the same reason `revokeAllForUser` does.
   */
  async deleteExpired(before: Date): Promise<number | null> {
    try {
      const result = await this.prisma.session.deleteMany({
        where: { absoluteExpiresAt: { lt: before } },
      });
      return result.count;
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in SessionRepository.deleteExpired');
      return null;
    }
  }
}

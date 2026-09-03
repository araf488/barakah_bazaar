import { Inject, Injectable } from '@nestjs/common';
import { MfaRecoveryCode, User } from '../../infra/prisma/prisma-client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthTokens } from './auth.constants';
import { SessionCachePort } from './sessions/session-cache.port';

/**
 * Persistence for the local `users` row.
 *
 * Returns null on failure instead of throwing, so the caller branches on a
 * value rather than unwinding — a database fault must not surface as an
 * unhandled 500.
 */
@Injectable()
export class AuthRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AuthTokens.SessionCache) private readonly sessionCache: SessionCachePort,
    @InjectPinoLogger(AuthRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Reads the local row by its own id.
   *
   * Three-valued on purpose: `undefined` means there is no such row, `null` means the read
   * itself failed. Collapsing them would answer "user not found" to a caller during a
   * database outage — a 404 that sends everyone hunting in the wrong place.
   */
  async findById(id: string): Promise<User | null | undefined> {
    try {
      return (await this.prisma.user.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, userId: id },
        'Exception occurred in AuthRepository.findById',
      );
      return null;
    }
  }

  /**
   * Looks a user up by email, case-insensitively.
   *
   * Used to refuse a staff invitation to an address that already has an account: two paths to
   * the same state invite drift, and changing a role is the other endpoint. Login uses it too,
   * to resolve the account behind an address before checking its password.
   */
  async findByEmail(email: string): Promise<User | null | undefined> {
    try {
      return (
        (await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthRepository.findByEmail');
      return null;
    }
  }

  /**
   * Rewrites the stored hash after a successful login at weaker-than-configured parameters.
   *
   * The only writer of `passwordHash` in this codebase today — there is no user-initiated
   * "change password" flow yet, so every call here is an automatic rehash of an unchanged
   * credential, triggered by `LoginService.rehashIfNeeded` on a successful login. It still
   * bumps the cache generation: the brief's non-negotiable is "password change", stated as a
   * field, not as a narrower "user-initiated change password" flow, and a spurious bump here
   * costs at most one extra database read on the account's other live sessions — cheap insurance
   * against a future password-change endpoint landing on this same method without anyone
   * remembering to wire the invalidation in a second place.
   */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<User | null> {
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });

      // After the write commits, not before — see AdminUserRepository.updateAudited for why.
      await this.sessionCache.invalidateUser(userId);

      return updated;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AuthRepository.updatePasswordHash',
      );
      return null;
    }
  }

  /**
   * Stores a freshly generated, encrypted TOTP secret. Not yet enrolled — see `enableTotp`.
   *
   * No cache invalidation: an unconfirmed secret changes nothing `CachedSessionValue` carries
   * and does not itself end any session, exactly like it does not today when the cache does
   * not exist. TOTP enrolment does not revoke a caller's other sessions in this codebase, and
   * caching read validation does not change that decision — it only mirrors it.
   */
  async saveTotpSecret(userId: string, encryptedSecret: string): Promise<User | null> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: encryptedSecret },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AuthRepository.saveTotpSecret',
      );
      return null;
    }
  }

  /**
   * Confirms enrolment: stamps `totpEnabledAt`, clears any prior lockout, and replaces every
   * recovery code with a freshly generated set.
   *
   * One transaction, because a user who saw the recovery codes but whose `totpEnabledAt` write
   * failed (or vice versa) is left unable to sign in with a factor the client believes is live.
   *
   * No cache invalidation, same reasoning as `saveTotpSecret`: enabling MFA does not revoke the
   * caller's other live sessions today, and none of `totpEnabledAt`/`totpLastUsedStep`/
   * `totpFailedAttempts`/`totpLockedUntil` are in `CachedSessionValue`.
   */
  async enableTotp(
    userId: string,
    lastUsedStep: number,
    recoveryCodeHashes: readonly string[],
  ): Promise<User | null> {
    try {
      const [, , user] = await this.prisma.$transaction([
        this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
        this.prisma.mfaRecoveryCode.createMany({
          data: recoveryCodeHashes.map((codeHash) => ({ userId, codeHash })),
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: {
            totpEnabledAt: new Date(),
            totpLastUsedStep: lastUsedStep,
            totpFailedAttempts: 0,
            totpLockedUntil: null,
          },
        }),
      ]);
      return user;
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Exception occurred in AuthRepository.enableTotp');
      return null;
    }
  }

  /**
   * Turns TOTP off: clears the secret and every recovery code in one transaction.
   *
   * No cache invalidation, same reasoning as `saveTotpSecret` — disabling a second factor
   * changes no field the cache carries and ends no session, before or after this task.
   */
  async disableTotp(userId: string): Promise<User | null> {
    try {
      const [, user] = await this.prisma.$transaction([
        this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
        this.prisma.user.update({
          where: { id: userId },
          data: {
            totpSecretEncrypted: null,
            totpEnabledAt: null,
            totpLastUsedStep: null,
            totpFailedAttempts: 0,
            totpLockedUntil: null,
          },
        }),
      ]);
      return user;
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Exception occurred in AuthRepository.disableTotp');
      return null;
    }
  }

  /**
   * Records a failed TOTP/recovery-code attempt, and the lockout deadline once one is set.
   *
   * No cache invalidation: a lockout counter is exactly the kind of field the brief calls out
   * as not belonging in the cached value at all, and it gates a future *login* attempt, not an
   * existing session's validity.
   */
  async recordTotpFailure(
    userId: string,
    failedAttempts: number,
    lockedUntil: Date | null,
  ): Promise<User | null> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { totpFailedAttempts: failedAttempts, totpLockedUntil: lockedUntil },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AuthRepository.recordTotpFailure',
      );
      return null;
    }
  }

  /**
   * Clears the lockout and records the spent step after a successful code or recovery code.
   *
   * No cache invalidation, same reasoning as `recordTotpFailure` — the fields it writes are
   * MFA-verification bookkeeping, not anything `CachedSessionValue` carries.
   */
  async resetTotpState(userId: string, lastUsedStep: number): Promise<User | null> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { totpFailedAttempts: 0, totpLockedUntil: null, totpLastUsedStep: lastUsedStep },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AuthRepository.resetTotpState',
      );
      return null;
    }
  }

  /** The unused recovery code matching this hash, if any. Never the plaintext — it is a hash. */
  async findUnusedRecoveryCode(
    userId: string,
    codeHash: string,
  ): Promise<MfaRecoveryCode | null | undefined> {
    try {
      return (
        (await this.prisma.mfaRecoveryCode.findFirst({
          where: { userId, codeHash, usedAt: null },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AuthRepository.findUnusedRecoveryCode',
      );
      return null;
    }
  }

  /** Marks one recovery code spent. `false` only on a write failure — the caller must not act. */
  async burnRecoveryCode(id: string): Promise<boolean> {
    try {
      await this.prisma.mfaRecoveryCode.updateMany({
        where: { id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthRepository.burnRecoveryCode');
      return false;
    }
  }
}

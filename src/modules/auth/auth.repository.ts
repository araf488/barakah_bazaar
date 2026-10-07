import { Inject, Injectable } from '@nestjs/common';
import { Language, MfaRecoveryCode, User, UserRole } from '../../infra/prisma/prisma-client';
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
   * Creates a customer account. Staff accounts are invitation-only and are not created here.
   *
   * `null` on any failure, including a unique-constraint rejection: the caller races another
   * registration for the same address, and "could not create" is all it needs to know.
   */
  async createCustomer(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    preferredLanguage: Language;
  }): Promise<User | null> {
    try {
      return await this.prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          preferredLanguage: data.preferredLanguage,
          role: UserRole.CUSTOMER,
        },
      });
    } catch (error) {
      // No passwordHash in the line, and no email either — this runs on an unauthenticated route.
      this.logger.error({ err: error }, 'Exception occurred in AuthRepository.createCustomer');
      return null;
    }
  }

  /**
   * Writes a new password hash as a real password change: stamps `passwordChangedAt` and bumps
   * the session-cache generation. Callers are the password reset and change flows
   * (`PasswordUpdater`); the login-time rehash uses `updatePasswordEncoding` instead.
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
   * Re-encodes an unchanged credential at new scrypt parameters — the login-time rehash.
   *
   * Deliberately not `updatePasswordHash`: that is a password *change*, and it stamps
   * `passwordChangedAt`, which sign-in compares against the snapshot it authenticated with
   * (`SessionService.issue`, the intermediate-token `pca` claim). A rehash stamping it would
   * make a concurrent sign-in of the same account fail as if the password had changed. No
   * cache bump either: nothing `CachedSessionValue` carries depends on the hash.
   *
   * A conditional write, never a blind one: it lands only while the row still holds
   * `expectedHash`, the hash the caller verified the password against. A reset or change that
   * wrote a new hash in the meantime makes it match nothing, so the old password is never
   * written back over the new one. Returns `true` when the re-encode landed, `false` when it was
   * superseded (nothing written), and `null` on a write fault.
   */
  async updatePasswordEncoding(
    userId: string,
    expectedHash: string,
    passwordHash: string,
  ): Promise<boolean | null> {
    try {
      const result = await this.prisma.user.updateMany({
        where: { id: userId, passwordHash: expectedHash },
        data: { passwordHash },
      });

      return result.count === 1;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AuthRepository.updatePasswordEncoding',
      );
      return null;
    }
  }

  /**
   * Stamps `emailVerifiedAt` once `EmailVerificationService` has confirmed a token or code.
   *
   * No cache invalidation, same reasoning as `saveTotpSecret`: `emailVerifiedAt` is not a
   * field `CachedSessionValue` carries, and confirming an address does not revoke or otherwise
   * change any live session.
   */
  async updateEmailVerifiedAt(userId: string): Promise<User | null> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in AuthRepository.updateEmailVerifiedAt',
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
   *
   * Conditional on `expectedPasswordChangedAt`, the value the caller checked the enrolment
   * token's credential stamp against. A password reset landing between that check and this
   * write makes the guarded update match nothing; the transaction then writes nothing at all —
   * no recovery codes, no `totpEnabledAt` — so an old-password holder cannot enrol a factor
   * that would lock the real owner out. The guarded update runs first for exactly that reason.
   *
   * Returns the enabled user, `undefined` when the credential changed (nothing written), and
   * `null` on a fault.
   */
  async enableTotp(
    userId: string,
    expectedPasswordChangedAt: Date | null,
    lastUsedStep: number,
    recoveryCodeHashes: readonly string[],
  ): Promise<User | null | undefined> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const enabled = await tx.user.updateMany({
          where: { id: userId, passwordChangedAt: expectedPasswordChangedAt },
          data: {
            totpEnabledAt: new Date(),
            totpLastUsedStep: lastUsedStep,
            totpFailedAttempts: 0,
            totpLockedUntil: null,
          },
        });

        if (enabled.count !== 1) {
          return undefined;
        }

        await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
        await tx.mfaRecoveryCode.createMany({
          data: recoveryCodeHashes.map((codeHash) => ({ userId, codeHash })),
        });

        return await tx.user.findUniqueOrThrow({ where: { id: userId } });
      });
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
    /** When the current run of failures began, or null to end the run. */
    firstFailedAt: Date | null,
  ): Promise<User | null> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          totpFailedAttempts: failedAttempts,
          totpLockedUntil: lockedUntil,
          totpFirstFailedAt: firstFailedAt,
        },
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
        data: {
          totpFailedAttempts: 0,
          totpLockedUntil: null,
          // Cleared with the count it belongs to: a successful code ends the run, so the next
          // failure starts a fresh window rather than continuing an old one.
          totpFirstFailedAt: null,
          totpLastUsedStep: lastUsedStep,
        },
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

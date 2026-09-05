import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthConstants, AuthMessages } from './auth.constants';
import { AuthEventsService } from './auth-events.service';
import { AuthRepository } from './auth.repository';
import { PasswordHasher } from './crypto/password-hasher';
import { SecretCipher } from './crypto/secret-cipher';
import { TotpVerification, TotpService } from './crypto/totp.service';
import { AuthSettingsService } from './settings/auth-settings.service';
import { IssuedSession, SessionService } from './sessions/session.service';
import { AccessTokenService } from './tokens/access-token.service';

/**
 * The crypto/hashing collaborators `MfaService` needs, bundled into one injected dependency
 * (Sonar S107 — a sixth constructor parameter here would be the eighth on `MfaService`).
 */
@Injectable()
export class MfaCryptoSupport {
  constructor(
    readonly cipher: SecretCipher,
    readonly totp: TotpService,
    readonly hasher: PasswordHasher,
  ) {}
}

export interface MfaSetup {
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface MfaEnableResult {
  readonly recoveryCodes: readonly string[];
}

/** Either credential a caller can present to `verifyLogin`. Exactly one is expected. */
export interface MfaCredential {
  readonly code?: string;
  readonly recoveryCode?: string;
}

/**
 * Second-factor enrolment and verification: TOTP secret issuance, enabling/disabling a factor,
 * and completing a login that an `mfa` token is waiting on.
 *
 * Nothing here calls out to a third party — the secret never leaves this process unencrypted,
 * and the QR code is drawn by the client from the `otpauth://` URI this returns.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly crypto: MfaCryptoSupport,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly settings: AuthSettingsService,
    private readonly events: AuthEventsService,
    @InjectPinoLogger(MfaService.name) private readonly logger: PinoLogger,
  ) {}

  private static isStaff(role: UserRole): boolean {
    return role !== UserRole.CUSTOMER;
  }

  private static hashRecoveryCode(code: string): string {
    return createHash('sha256').update(code).digest('base64url');
  }

  private static generateRecoveryCodes(): string[] {
    return Array.from({ length: AuthConstants.TotpRecoveryCodeCount }, () =>
      randomBytes(AuthConstants.TotpRecoveryCodeBytes).toString('hex'),
    );
  }

  /** Issues a new secret and stores it, unconfirmed. `enable` is what turns it on. */
  async setup(user: User): Promise<ServiceResponse<MfaSetup>> {
    try {
      const secret = this.crypto.totp.generateSecret();
      const updated = await this.repository.saveTotpSecret(
        user.id,
        this.crypto.cipher.encrypt(secret),
      );

      if (!updated) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk({
        secret,
        otpauthUri: this.crypto.totp.buildUri(secret, user.email ?? user.id),
      });
    } catch (error) {
      this.logger.error({ err: error, userId: user.id }, 'Exception occurred in MfaService.setup');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Confirms the secret `setup` issued and turns MFA on, handing back one-time recovery codes. */
  async enable(user: User, code: string): Promise<ServiceResponse<MfaEnableResult>> {
    try {
      const secret = user.totpSecretEncrypted
        ? this.crypto.cipher.decrypt(user.totpSecretEncrypted)
        : null;

      if (!secret) {
        return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.MfaSetupRequired);
      }

      const verification = this.crypto.totp.verify(secret, code, user.totpLastUsedStep);
      if (!verification.ok) {
        return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidMfaCode);
      }

      const codes = MfaService.generateRecoveryCodes();
      const enabled = await this.repository.enableTotp(
        user.id,
        verification.step,
        codes.map((plain) => MfaService.hashRecoveryCode(plain)),
      );

      if (!enabled) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk({ recoveryCodes: codes });
    } catch (error) {
      this.logger.error({ err: error, userId: user.id }, 'Exception occurred in MfaService.enable');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Completes a login an `mfa` token is waiting on: verifies the token, checks the lockout,
   * verifies the presented code or burns a recovery code, then issues the session.
   */
  async verifyLogin(
    mfaToken: string,
    credential: MfaCredential,
    deviceId: string,
    userAgent: string | null,
    ip: string | null,
  ): Promise<ServiceResponse<IssuedSession>> {
    try {
      const user = await this.resolveMfaUser(mfaToken, deviceId);
      if (!user.ok) {
        return user;
      }

      const lockError = MfaService.checkLockout(user.data);
      if (lockError) {
        return lockError;
      }

      const verified = await this.verifyCredential(user.data, credential);
      if (!verified.ok) {
        // The password was already right — only the second factor was not, which is a much
        // stronger signal than a failed password and is recorded separately for that reason.
        await this.events.recordMfaFailed(user.data, {
          sessionId: AuthConstants.PendingSessionId,
          deviceId,
          userAgent,
          ip,
        });
        return verified;
      }

      return await this.sessions.issue(user.data, deviceId, userAgent, ip);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in MfaService.verifyLogin');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Turns MFA off. Refused for staff while `staffMfaRequired` — there is no opt-out for them. */
  async disable(user: User, password: string, code: string): Promise<ServiceResponse<void>> {
    try {
      const passwordOk =
        !!user.passwordHash && (await this.crypto.hasher.verify(password, user.passwordHash));
      if (!passwordOk) {
        return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
      }

      const settings = await this.settings.current();
      if (MfaService.isStaff(user.role) && settings.staffMfaRequired) {
        return serviceFail(HttpStatus.FORBIDDEN, AuthMessages.MfaCannotBeDisabledForStaff);
      }

      const secret = user.totpSecretEncrypted
        ? this.crypto.cipher.decrypt(user.totpSecretEncrypted)
        : null;
      if (!secret) {
        return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.MfaSetupRequired);
      }

      if (!this.crypto.totp.verify(secret, code, user.totpLastUsedStep).ok) {
        return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidMfaCode);
      }

      const disabled = await this.repository.disableTotp(user.id);
      if (!disabled) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.id },
        'Exception occurred in MfaService.disable',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── verifyLogin helpers ──────────────────────────────────────────────────

  /** Verifies the `mfa` token and resolves the user it names. One message for every failure. */
  private async resolveMfaUser(mfaToken: string, deviceId: string): Promise<ServiceResponse<User>> {
    // A device mismatch is not acted on here, unlike in the guard: an `mfa` token names no
    // session yet — its `sid` is the pending-session placeholder — so there is nothing to
    // revoke. It is simply another way for the exchange to fail.
    const verified = await this.tokens.verify(mfaToken, deviceId, 'mfa');
    if (!verified.ok) {
      return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
    }

    const user = await this.repository.findById(verified.claims.userId);
    if (user === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }
    if (user === undefined || !user.totpSecretEncrypted) {
      return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
    }

    return serviceOk(user);
  }

  private static checkLockout(user: User): ServiceResponse<never> | null {
    if (user.totpLockedUntil && user.totpLockedUntil.getTime() > Date.now()) {
      return serviceFail(HttpStatus.TOO_MANY_REQUESTS, AuthMessages.MfaLocked);
    }
    return null;
  }

  private async verifyCredential(
    user: User,
    credential: MfaCredential,
  ): Promise<ServiceResponse<void>> {
    if (credential.recoveryCode) {
      return this.verifyRecoveryCode(user, credential.recoveryCode);
    }
    return this.verifyTotpCode(user, credential.code ?? '');
  }

  private async verifyTotpCode(user: User, code: string): Promise<ServiceResponse<void>> {
    // Guarded by resolveMfaUser already requiring a secret to exist, but re-checked here since
    // this method has no other way to obtain one — decryption failing is a fault, not a wrong
    // code, so it is reported distinctly rather than counted as a failed attempt.
    const secret = user.totpSecretEncrypted
      ? this.crypto.cipher.decrypt(user.totpSecretEncrypted)
      : null;
    if (!secret) {
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }

    const verification: TotpVerification = this.crypto.totp.verify(
      secret,
      code,
      user.totpLastUsedStep,
    );
    if (!verification.ok) {
      await this.registerFailure(user);
      return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidMfaCode);
    }

    await this.repository.resetTotpState(user.id, verification.step);
    return serviceOk<void>(undefined);
  }

  private async verifyRecoveryCode(
    user: User,
    recoveryCode: string,
  ): Promise<ServiceResponse<void>> {
    const found = await this.repository.findUnusedRecoveryCode(
      user.id,
      MfaService.hashRecoveryCode(recoveryCode),
    );

    if (found === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }
    if (found === undefined) {
      await this.registerFailure(user);
      return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidMfaCode);
    }

    await this.repository.burnRecoveryCode(found.id);
    // No TOTP step was spent by a recovery code, so there is nothing to advance — only the
    // failure counter, its window and the lockout are cleared. Passing `null` for the window
    // is what ends the run: the next failure starts counting again from one.
    await this.repository.recordTotpFailure(user.id, 0, null, null);
    return serviceOk<void>(undefined);
  }

  /** Increments the failed-attempt counter and sets a lockout once it reaches the ceiling. */
  private async registerFailure(user: User): Promise<void> {
    const now = Date.now();
    const runStart = MfaService.currentRunStart(user, now);
    const attempts = runStart === null ? 1 : user.totpFailedAttempts + 1;
    const lockedUntil =
      attempts >= AuthConstants.TotpMaxFailedAttempts
        ? new Date(now + AuthConstants.TotpLockoutMinutes * AuthConstants.MillisecondsPerMinute)
        : null;

    await this.repository.recordTotpFailure(
      user.id,
      attempts,
      lockedUntil,
      runStart ?? new Date(now),
    );
  }

  /**
   * When the run of failures this one belongs to began, or `null` to start a new run.
   *
   * The rule is "five failed codes within an hour", so the count has to expire: without this
   * it only ever reset on a *successful* verification, and five fumbles months apart locked an
   * account nobody was attacking.
   *
   * A lockout that has already been served also starts a fresh run. Otherwise the sixth
   * failure of an hour — the first attempt after serving fifteen minutes — would re-lock
   * immediately, which turns one bad evening into a cycle nobody can get out of.
   */
  private static currentRunStart(user: User, now: number): Date | null {
    const servedLockout = user.totpLockedUntil !== null && user.totpLockedUntil.getTime() <= now;

    if (servedLockout || user.totpFirstFailedAt === null) {
      return null;
    }

    const windowMs = AuthConstants.TotpFailureWindowMinutes * AuthConstants.MillisecondsPerMinute;

    return now - user.totpFirstFailedAt.getTime() <= windowMs ? user.totpFirstFailedAt : null;
  }
}

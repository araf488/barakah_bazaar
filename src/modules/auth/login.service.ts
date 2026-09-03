import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthConstants, AuthMessages } from './auth.constants';
import { AuthRepository } from './auth.repository';
import { PasswordHasher } from './crypto/password-hasher';
import { LoginDto } from './dto/login.dto';
import { ResolvedAuthSettings, AuthSettingsService } from './settings/auth-settings.service';
import { IssuedSession, SessionService } from './sessions/session.service';
import { AccessTokenService } from './tokens/access-token.service';

/** Which portal a role signs into. Every non-customer role is staff, and staff use the admin portal. */
export type Portal = 'ADMIN' | 'STOREFRONT';

export const portalFor = (role: UserRole): Portal =>
  role === UserRole.CUSTOMER ? 'STOREFRONT' : 'ADMIN';

/**
 * What a login attempt produces. `session` is a completed sign-in; `mfa` and `enrolment` are
 * both intermediate — the caller holds a short-lived token and must call `MfaService` next to
 * finish.
 */
export type LoginResult =
  | { readonly kind: 'session'; readonly session: IssuedSession; readonly portal: Portal }
  | { readonly kind: 'mfa'; readonly mfaToken: string }
  | { readonly kind: 'enrolment'; readonly enrolmentToken: string };

/**
 * Verifies a password and decides what happens next: a session, a request for a second factor,
 * or a demand to enrol one.
 *
 * The check order below is a security requirement, not a style choice — see the inline
 * comments on `login`. In particular, a password is verified on *every* call, real or dummy,
 * so response time cannot be used to enumerate registered addresses, and every account-state
 * rejection (disabled, unverified) happens only after that verification succeeds.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly settings: AuthSettingsService,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    @InjectPinoLogger(LoginService.name) private readonly logger: PinoLogger,
  ) {}

  private static isStaff(role: UserRole): boolean {
    return role !== UserRole.CUSTOMER;
  }

  async login(
    dto: LoginDto,
    deviceId: string,
    userAgent: string | null,
    ip: string | null,
  ): Promise<ServiceResponse<LoginResult>> {
    try {
      const user = await this.repository.findByEmail(dto.email);

      if (user === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      // Always verify a password — the account's real hash, or a fixed dummy one when no
      // account matched — so a wrong password and an unknown address cost the same time and
      // answer with the same message. Skipping this call when `user` is undefined is exactly
      // the timing side-channel it exists to close.
      const passwordOk = await this.hasher.verify(
        dto.password,
        user?.passwordHash ?? PasswordHasher.DUMMY_HASH,
      );

      if (!user || !passwordOk) {
        return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
      }

      const settings = await this.settings.current();
      const ineligible = LoginService.checkEligibility(user, settings);
      if (ineligible) {
        return ineligible;
      }

      await this.rehashIfNeeded(user, dto.password);

      if (user.totpEnabledAt) {
        return serviceOk({
          kind: 'mfa',
          mfaToken: await this.signIntermediateToken(user, deviceId, 'mfa'),
        });
      }

      if (LoginService.isStaff(user.role) && settings.staffMfaRequired) {
        return serviceOk({
          kind: 'enrolment',
          enrolmentToken: await this.signIntermediateToken(user, deviceId, 'enrolment'),
        });
      }

      const issued = await this.sessions.issue(user, deviceId, userAgent, ip);
      if (!issued.ok) {
        return issued;
      }

      return serviceOk({ kind: 'session', session: issued.data, portal: portalFor(user.role) });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in LoginService.login');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Everything that can disqualify an already-authenticated user from signing in: disabled
   * first, then unverified-past-grace. Returns the failure, or `null` when login may continue.
   *
   * Order matters here too — `AccountDisabled` and `EmailNotVerified` are both only reached
   * after the password check above, so neither can be used to test whether an address exists.
   */
  private static checkEligibility(
    user: User,
    settings: ResolvedAuthSettings,
  ): ServiceResponse<never> | null {
    if (!user.isActive) {
      return serviceFail(HttpStatus.FORBIDDEN, ErrorMessages.AccountDisabled);
    }

    if (
      user.emailVerifiedAt === null &&
      LoginService.pastVerificationGrace(user.createdAt, settings.emailVerificationGraceHours)
    ) {
      return serviceFail(HttpStatus.FORBIDDEN, AuthMessages.EmailNotVerified);
    }

    return null;
  }

  private static pastVerificationGrace(createdAt: Date, graceHours: number): boolean {
    const graceMs = graceHours * 60 * AuthConstants.MillisecondsPerMinute;
    return Date.now() - createdAt.getTime() > graceMs;
  }

  /**
   * Rewrites the stored hash at the current scrypt parameters. Never fatal: the password just
   * verified, so the user is already signing in, and a rehash failure here should not undo
   * that — it is retried on the next successful login.
   */
  private async rehashIfNeeded(user: User, plainPassword: string): Promise<void> {
    if (!user.passwordHash || !this.hasher.needsRehash(user.passwordHash)) {
      return;
    }

    try {
      const nextHash = await this.hasher.hash(plainPassword);
      const updated = await this.repository.updatePasswordHash(user.id, nextHash);

      if (!updated) {
        this.logger.warn({ userId: user.id }, 'Password rehash failed to persist; continuing');
      }
    } catch (error) {
      this.logger.warn({ err: error, userId: user.id }, 'Password rehash failed; continuing');
    }
  }

  /** Signs the short-lived token that hands off to `MfaService` for the given `type`. */
  private async signIntermediateToken(
    user: User,
    deviceId: string,
    type: 'mfa' | 'enrolment',
  ): Promise<string> {
    return this.tokens.sign(
      {
        userId: user.id,
        sessionId: AuthConstants.PendingSessionId,
        role: user.role,
        email: user.email ?? '',
        deviceId,
      },
      AuthConstants.MfaTokenMinutes,
      type,
    );
  }
}

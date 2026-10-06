import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger, getLoggerToken } from 'nestjs-pino';
import { Env } from '../../config';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { createEmailSender } from '../notification/gateways/email-sender.factory';
import { AuthConstants, AuthTokens } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthEventsService } from './auth-events.service';
import { SessionSweeper } from './session-sweeper.service';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password-hasher';
import { SecretCipher } from './crypto/secret-cipher';
import { TotpService } from './crypto/totp.service';
import { createSmsGateway } from './gateways/sms-gateway.factory';
import { LoginService } from './login.service';
import { MfaCryptoSupport, MfaService } from './mfa.service';
import { PasswordDependencies } from './password.dependencies';
import { PasswordResetRepository } from './password-reset/password-reset.repository';
import { PasswordResetService } from './password-reset/password-reset.service';
import { PasswordChangeService } from './passwords/password-change.service';
import { PasswordPolicy } from './passwords/password-policy';
import { PasswordUpdater } from './passwords/password-updater';
import { RegistrationDependencies } from './registration.dependencies';
import { RegistrationService } from './registration.service';
import { AuthSettingsRepository } from './settings/auth-settings.repository';
import { AuthSettingsService } from './settings/auth-settings.service';
import { createSessionCache } from './sessions/session-cache.factory';
import { SessionRepository } from './sessions/session.repository';
import { SessionService } from './sessions/session.service';
import { SignInDependencies } from './sign-in.dependencies';
import { AccessTokenService } from './tokens/access-token.service';
import { EmailVerificationRepository } from './verification/email-verification.repository';
import { EmailVerificationService } from './verification/email-verification.service';

/**
 * Everything about who the caller is: the user table, the profile endpoint, the SMS/OTP ports
 * for the phone-login flow, and the tokens themselves. Nothing outside this module issues or
 * verifies a credential.
 *
 * It also owns the whole session/token/settings stack — `AccessTokenService`, `SessionService`
 * and their dependencies used to be a stopgap registration in `app.module.ts` (that module has
 * no other reason to know about them) because nothing provided them yet. They live here now,
 * and are exported for the one thing outside this module that still needs them directly:
 * `SessionAuthGuard`, registered globally in `app.module.ts`. There is exactly one registration
 * of each — duplicating any of these in `app.module.ts` as well would produce a second
 * `AuthSettingsService` cache and a second `AccessTokenService` signing key, silently
 * disagreeing with the one this module builds.
 *
 * AuthTokens.OtpService is intentionally not provided yet — see ports/otp.port.ts.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: AuthTokens.SmsGateway,
      inject: [ConfigService, PinoLogger],
      useFactory: createSmsGateway,
    },
    {
      provide: AuthTokens.SessionCache,
      inject: [ConfigService, PinoLogger],
      useFactory: createSessionCache,
    },

    // Password, TOTP and at-rest-secret crypto. Stateless beyond their own config, so plain
    // registration is enough — no factory needed.
    PasswordHasher,
    SecretCipher,
    TotpService,

    // Sessions, tokens and settings.
    AccessTokenService,
    SessionRepository,
    AuthSettingsRepository,
    {
      // AuthSettingsService.cacheSeconds is a plain `number`, which Nest cannot resolve by
      // type — this factory reads it from config and passes it positionally, exactly as its
      // constructor expects. Moved verbatim from app.module.ts's stopgap registration; do not
      // replace it with a plain `providers: [AuthSettingsService]` entry, which throws at boot.
      provide: AuthSettingsService,
      inject: [AuthSettingsRepository, getLoggerToken(AuthSettingsService.name), ConfigService],
      useFactory: (
        repository: AuthSettingsRepository,
        logger: PinoLogger,
        config: ConfigService<Env, true>,
      ) =>
        new AuthSettingsService(
          repository,
          logger,
          config.get('AUTH_SETTINGS_CACHE_SECONDS', { infer: true }),
        ),
    },
    SessionService,

    // The audit trail for authentication events.
    //
    // AuditLogRepository is registered here rather than imported from AdminModule because
    // AdminModule already imports THIS module — importing it back would be a circular module
    // reference. A second instance is harmless in a way a second AuthSettingsService or
    // AccessTokenService would not be: it holds no cache and no key, only PrismaService (which
    // is global) and a logger, so both instances write the same rows to the same table.
    AuditLogRepository,
    AuthEventsService,

    // Reclaims expired session rows and the recovery codes of disabled accounts. A plain
    // interval, so it works on a deployment with no Redis — see the class comment.
    SessionSweeper,

    // Login and MFA.
    MfaCryptoSupport,
    LoginService,
    MfaService,
    // Bundles LoginService and MfaService for AuthController — see sign-in.dependencies.ts.
    SignInDependencies,

    // Registration and email verification.
    //
    // The email sender is bound here rather than imported from a shared module, matching how
    // AdminModule binds its own — registration/verification mail and admin mail are different
    // audiences, and this keeps the auth module's DI wiring independent of the admin module's.
    // This does mean two `EmailSender` instances live in one process (this one and admin's),
    // i.e. two nodemailer transports under EMAIL_PROVIDER=smtp — accepted, not unified: each
    // pools its own connections, at the cost of one extra idle connection to the relay.
    PasswordPolicy,
    EmailVerificationRepository,
    EmailVerificationService,
    RegistrationService,
    {
      provide: AuthTokens.EmailSender,
      inject: [ConfigService, PinoLogger],
      useFactory: createEmailSender,
    },

    // Bundles RegistrationService and EmailVerificationService for AuthController, which would
    // otherwise sit at the 7-parameter S107 ceiling — see registration.dependencies.ts.
    RegistrationDependencies,

    // Password reset and change. PasswordUpdater holds what the two flows share — policy,
    // revoke-before-write, audit, mail — and PasswordDependencies bundles the two services for
    // AuthController, which would otherwise reach the S107 ceiling.
    PasswordUpdater,
    PasswordResetRepository,
    PasswordResetService,
    PasswordChangeService,
    PasswordDependencies,
  ],
  // AuthRepository is exported because it owns the user table, which the admin module's
  // invitation flow must read (by id, and by email). Re-providing it there would create a
  // second instance of the same table's accessor.
  //
  // AccessTokenService and SessionService are exported for SessionAuthGuard — see the class
  // comment above.
  //
  // AuthTokens.SessionCache is exported so AdminUserRepository (a different module) can bump a
  // user's cache generation on the same admin-side role/isActive writes that already run
  // through it, without a second Redis client or a second no-op default disagreeing with this
  // one.
  exports: [
    AuthService,
    AuthRepository,
    AccessTokenService,
    SessionService,
    AuthTokens.SessionCache,
  ],
})
export class AuthModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = AuthConstants;
}

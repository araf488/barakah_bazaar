import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger, getLoggerToken } from 'nestjs-pino';
import { Env } from '../../config';
import { AuthConstants, AuthTokens } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password-hasher';
import { SecretCipher } from './crypto/secret-cipher';
import { TotpService } from './crypto/totp.service';
import { createSmsGateway } from './gateways/sms-gateway.factory';
import { LoginService } from './login.service';
import { MfaCryptoSupport, MfaService } from './mfa.service';
import { AuthSettingsRepository } from './settings/auth-settings.repository';
import { AuthSettingsService } from './settings/auth-settings.service';
import { SessionRepository } from './sessions/session.repository';
import { SessionService } from './sessions/session.service';
import { AccessTokenService } from './tokens/access-token.service';

/**
 * Token verification itself lives in SupabaseModule (the verifier is needed by
 * the globally registered guard); this module owns the application-side
 * identity: the local user mirror, the profile endpoint, and the SMS/OTP ports
 * for the custom phone-login flow.
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

    // Login and MFA.
    MfaCryptoSupport,
    LoginService,
    MfaService,
  ],
  // AuthRepository is exported because it owns the local user mirror, which the admin
  // module's invitation flow must read (by email, and by Supabase id). Re-providing it there
  // would create a second instance of the same table's accessor.
  //
  // AccessTokenService and SessionService are exported for SessionAuthGuard — see the class
  // comment above.
  exports: [AuthService, AuthRepository, AccessTokenService, SessionService],
})
export class AuthModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = AuthConstants;
}

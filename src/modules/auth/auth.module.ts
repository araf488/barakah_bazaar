import { Module } from '@nestjs/common';
import { AuthConstants, AuthTokens } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { NoopSmsGateway } from './gateways/noop-sms.gateway';

/**
 * Token verification itself lives in SupabaseModule (the verifier is needed by
 * the globally registered guard); this module owns the application-side
 * identity: the local user mirror, the profile endpoint, and the SMS/OTP ports
 * for the custom phone-login flow.
 *
 * AuthTokens.OtpService is intentionally not provided yet — see ports/otp.port.ts.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    { provide: AuthTokens.SmsGateway, useClass: NoopSmsGateway },
  ],
  exports: [AuthService],
})
export class AuthModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = AuthConstants;
}

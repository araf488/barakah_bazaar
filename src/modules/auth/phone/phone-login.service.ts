import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../../common/constants/error-messages.constants';
import { BangladeshPhone } from '../../../common/phone/bangladesh-phone';
import { ServiceResponse, serviceFail, serviceOk } from '../../../common/types/service-response';
import { User, UserRole } from '../../../infra/prisma/prisma-client';
import { AuthEventsService } from '../auth-events.service';
import { AuthConstants, AuthMessages } from '../auth.constants';
import { AuthRepository } from '../auth.repository';
import { codeMatches, isLive } from '../credentials/emailed-credential';
import { LoginResult, LoginService } from '../login.service';
import { PhoneConfirmDto, PhoneCodeSentDto, PhoneRequestDto } from './dto/phone.dto';
import { PhoneCodeIssuer } from './phone-code.issuer';
import { PhoneLoginChallengeRepository } from './phone-login-challenge.repository';

/**
 * Signs a customer in by a code texted to their verified number.
 *
 * `request` answers identically whether or not the number belongs to an eligible account, so
 * it cannot be used to find out which numbers are registered. `verify` answers every refusal
 * with the same 401 as a wrong password.
 */
@Injectable()
export class PhoneLoginService {
  constructor(
    private readonly users: AuthRepository,
    private readonly challenges: PhoneLoginChallengeRepository,
    private readonly issuer: PhoneCodeIssuer,
    private readonly login: LoginService,
    private readonly events: AuthEventsService,
    @InjectPinoLogger(PhoneLoginService.name) private readonly logger: PinoLogger,
  ) {}

  /** Texts a sign-in code when the number belongs to an eligible customer; always the same answer. */
  async request(
    dto: PhoneRequestDto,
    ip: string | null,
  ): Promise<ServiceResponse<PhoneCodeSentDto>> {
    try {
      const phone = BangladeshPhone.normalize(dto.phone);
      const limits = this.issuer.limits();

      const exhausted = await this.challenges.globalLimitReached(limits.globalDaily);
      if (exhausted === null) return this.unavailable();
      if (exhausted) return this.smsUnavailable();

      const user = await this.users.findByPhone(phone);
      if (user === null) return this.unavailable();

      const answer = serviceOk({
        expiresInSeconds: AuthConstants.PhoneCodeTtlSeconds,
        resendAfterSeconds: limits.cooldownSeconds,
      });
      if (user === undefined || !user.isActive || !PhoneLoginService.holdsVerified(user, phone)) {
        return answer;
      }

      const minted = this.issuer.mint();
      const issued = await this.challenges.issue(
        {
          userId: user.id,
          phone,
          codeHash: minted.codeHash,
          expiresAt: minted.expiresAt,
          ipAddress: ip,
        },
        limits,
      );
      if (issued === null) return this.unavailable();
      if (issued.kind === 'global-limit') {
        // Another request spent the last slot between the pre-check and the issue.
        this.issuer.reportDailyLimit();
      }
      if (issued.kind !== 'issued') return answer;

      // Not awaited: the outbound text can take seconds, and only an eligible number reaches
      // it, so waiting would let response time reveal which numbers are registered.
      void this.sendDetached(phone, minted.code);
      return answer;
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PhoneLoginService.request');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Checks the texted code and, when it is right, signs the owner in like a password would. */
  async verify(
    dto: PhoneConfirmDto,
    deviceId: string,
    userAgent: string | null,
    ip: string | null,
  ): Promise<ServiceResponse<LoginResult>> {
    try {
      const phone = BangladeshPhone.normalize(dto.phone);
      const challenge = await this.challenges.findNewestLiveForPhone(phone);
      if (challenge === null) return this.unavailable();
      if (!isLive(challenge)) return PhoneLoginService.invalid();

      // The guess slot is claimed atomically BEFORE the compare, so a concurrent burst cannot
      // out-guess the cap: only the calls that win a slot ever see whether the code matches.
      const claimed = await this.challenges.claimAttempt(challenge.id);
      if (claimed === null) return this.unavailable();
      if (!claimed) return PhoneLoginService.invalid();

      if (!codeMatches(dto.code, challenge.codeHash)) {
        await this.events.recordLoginFailed(challenge.user, {
          sessionId: AuthConstants.PendingSessionId,
          deviceId,
          userAgent,
          ip,
        });
        return PhoneLoginService.invalid();
      }

      const consumed = await this.challenges.consume(challenge.id);
      if (consumed === null) return this.unavailable();
      // The user was read with the challenge: a number changed or an account promoted since
      // the code was requested must not sign in on the strength of the old code.
      if (!consumed || !PhoneLoginService.holdsVerified(challenge.user, phone)) {
        return PhoneLoginService.invalid();
      }

      return await this.login.completeLogin(challenge.user, deviceId, userAgent, ip);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PhoneLoginService.verify');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Texts the code in the background; a refusal or a throw is logged, never surfaced. */
  private async sendDetached(phone: string, code: string): Promise<void> {
    try {
      if (!(await this.issuer.send(phone, code))) {
        this.logger.error('Phone sign-in code could not be sent');
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Phone sign-in code could not be sent');
    }
  }

  /**
   * A customer account that holds this number, verified. A disabled account is not refused
   * here: `completeLogin` does that with its own message, after the code has proved the caller.
   */
  private static holdsVerified(user: User, phone: string): boolean {
    return user.phone === phone && user.phoneVerifiedAt !== null && user.role === UserRole.CUSTOMER;
  }

  private static invalid<T>(): ServiceResponse<T> {
    return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
  }

  private smsUnavailable<T>(): ServiceResponse<T> {
    this.issuer.reportDailyLimit();
    return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AuthMessages.SmsUnavailable);
  }

  private unavailable<T>(): ServiceResponse<T> {
    return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
  }
}

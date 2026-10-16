import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages, formatMessage } from '../../../common/constants/error-messages.constants';
import { BangladeshPhone } from '../../../common/phone/bangladesh-phone';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../../common/types/service-response';
import { EmailSender } from '../../notification/ports/email-sender.port';
import { AuthConstants, AuthMessages, AuthTokens } from '../auth.constants';
import { AuthRepository } from '../auth.repository';
import { codeMatches, isLive } from '../credentials/emailed-credential';
import { buildPhoneChangedEmail } from '../emails/phone-changed-email';
import {
  PhoneConfirmDto,
  PhoneCodeSentDto,
  PhoneRequestDto,
  PhoneVerifiedDto,
} from './dto/phone.dto';
import { PhoneCodeIssuer } from './phone-code.issuer';
import {
  PhoneVerificationRepository,
  VerificationIssueResult,
} from './phone-verification.repository';

/** Proves a signed-in customer owns a phone number: a code by text, then the number is written. */
@Injectable()
export class PhoneVerificationService {
  constructor(
    private readonly users: AuthRepository,
    private readonly repository: PhoneVerificationRepository,
    private readonly issuer: PhoneCodeIssuer,
    @Inject(AuthTokens.EmailSender) private readonly email: EmailSender,
    @InjectPinoLogger(PhoneVerificationService.name) private readonly logger: PinoLogger,
  ) {}

  /** Texts a fresh code to the number. The code is never part of the response. */
  async request(
    user: AuthenticatedUser,
    dto: PhoneRequestDto,
  ): Promise<ServiceResponse<PhoneCodeSentDto>> {
    try {
      const phone = BangladeshPhone.normalize(dto.phone);
      // Before the ownership check: a 409 stores no row and counts nothing, so a capped account
      // must be turned away first or it could keep reading registered numbers off the 409.
      const capped = await this.repository.accountLimitReached(
        user.userId,
        this.issuer.accountDailyLimit(),
      );
      if (capped === null) return this.unavailable();
      if (capped) {
        return serviceFail(
          HttpStatus.TOO_MANY_REQUESTS,
          AuthMessages.PhoneVerificationAccountLimit,
        );
      }

      const refusal = await this.checkOwnership(user.userId, phone);
      if (refusal) return refusal;

      const minted = this.issuer.mint();
      const limits = this.issuer.limits();
      const issued = await this.repository.issue(
        { userId: user.userId, phone, codeHash: minted.codeHash, expiresAt: minted.expiresAt },
        limits,
        this.issuer.accountDailyLimit(),
      );
      const failure = this.issueFailure(issued);
      if (failure) return failure;

      if (!(await this.issuer.send(phone, minted.code))) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AuthMessages.SmsUnavailable);
      }
      return serviceOk({
        expiresInSeconds: AuthConstants.PhoneCodeTtlSeconds,
        resendAfterSeconds: limits.cooldownSeconds,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.userId },
        'Exception occurred in PhoneVerificationService.request',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Checks the code and, when it is right, writes the number onto the caller's account. */
  async confirm(
    user: AuthenticatedUser,
    dto: PhoneConfirmDto,
  ): Promise<ServiceResponse<PhoneVerifiedDto>> {
    try {
      const phone = BangladeshPhone.normalize(dto.phone);
      const row = await this.repository.findNewestLive(user.userId, phone);
      if (row === null) return this.unavailable();
      if (!isLive(row)) return serviceFail(HttpStatus.GONE, AuthMessages.PhoneCodeExpired);

      // The guess slot is claimed atomically BEFORE the compare, so a concurrent burst cannot
      // out-guess the cap: only the calls that win a slot ever see whether the code matches.
      const claimed = await this.repository.claimAttempt(row.id);
      if (claimed === null) return this.unavailable();
      if (!claimed) return serviceFail(HttpStatus.GONE, AuthMessages.PhoneCodeExpired);

      if (!codeMatches(dto.code, row.codeHash)) {
        return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.PhoneCodeInvalid);
      }

      const result = await this.repository.confirm(row.id, user.userId, phone);
      if (result === null) return this.unavailable();
      if (result.kind === 'already-used') {
        return serviceFail(HttpStatus.GONE, AuthMessages.PhoneCodeExpired);
      }
      if (result.kind === 'phone-in-use') {
        return serviceFail(HttpStatus.CONFLICT, AuthMessages.PhoneInUse);
      }

      // Every link adds a way to sign in, a first one included, so the owner always hears of it.
      await this.announceLink(user, result.fullName, phone);
      return serviceOk({ phone, phoneVerified: true });
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.userId },
        'Exception occurred in PhoneVerificationService.confirm',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Refuses a number another account holds, or one already verified on this account. The
   * caller's own unverified legacy number is allowed through: it is not "in use" by anyone else.
   */
  private async checkOwnership(
    userId: string,
    phone: string,
  ): Promise<ServiceResponse<PhoneCodeSentDto> | null> {
    const holder = await this.users.findByPhone(phone);
    if (holder === null) return this.unavailable();
    if (holder === undefined) return null;
    if (holder.id !== userId) return serviceFail(HttpStatus.CONFLICT, AuthMessages.PhoneInUse);
    if (holder.phoneVerifiedAt) {
      return serviceFail(HttpStatus.CONFLICT, AuthMessages.PhoneAlreadyVerified);
    }
    return null;
  }

  /** The refusal for a send the limits or the database turned away; `null` when it was stored. */
  private issueFailure(
    issued: VerificationIssueResult | null,
  ): ServiceResponse<PhoneCodeSentDto> | null {
    if (issued === null) return this.unavailable();
    switch (issued.kind) {
      case 'issued':
        return null;
      case 'global-limit':
        this.issuer.reportDailyLimit();
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AuthMessages.SmsUnavailable);
      case 'cooldown':
        return serviceFail(
          HttpStatus.TOO_MANY_REQUESTS,
          formatMessage(AuthMessages.PhoneCodeCooldownTemplate, String(issued.retryAfterSeconds)),
        );
      case 'number-limit':
        return serviceFail(HttpStatus.TOO_MANY_REQUESTS, AuthMessages.PhoneCodeDailyLimit);
      case 'account-limit':
        return serviceFail(
          HttpStatus.TOO_MANY_REQUESTS,
          AuthMessages.PhoneVerificationAccountLimit,
        );
    }
  }

  /** Tells the account's email a number was linked. A failure is logged, never surfaced. */
  private async announceLink(
    user: AuthenticatedUser,
    fullName: string | null,
    phone: string,
  ): Promise<void> {
    try {
      await this.email.send(
        buildPhoneChangedEmail({
          to: user.email,
          fullName: fullName ?? '',
          lastDigits: phone.slice(-3),
        }),
      );
    } catch (error) {
      this.logger.warn(
        { err: error, userId: user.userId },
        'Phone changed email could not be sent',
      );
    }
  }

  private unavailable<T>(): ServiceResponse<T> {
    return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
  }
}

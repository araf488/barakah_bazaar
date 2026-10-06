import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../../common/types/service-response';
import { AppConfigService } from '../../../config';
import { User } from '../../../infra/prisma/prisma-client';
import { EmailSender } from '../../notification/ports/email-sender.port';
import { AuthConstants, AuthMessages, AuthTokens } from '../auth.constants';
import { AuthRepository } from '../auth.repository';
import {
  codeMatches,
  generateCode,
  hashCredential,
  isLive,
  withinCooldown,
} from '../credentials/emailed-credential';
import { buildVerificationEmail, buildVerifiedEmail } from '../emails/verification-emails';
import {
  EmailVerificationRepository,
  EmailVerificationWithUser,
} from './email-verification.repository';

/** What `verify` accepts: a link token alone, or an email paired with a typed-in code. */
export interface VerifyEmailInput {
  readonly token?: string;
  readonly email?: string;
  readonly code?: string;
}

/**
 * Mints, mails, verifies and resends the email-verification credential.
 *
 * Every credential is a random value; only its SHA-256 is ever stored, matching
 * `SessionService.hashToken`'s shape. Unknown, expired and already-consumed records all answer
 * the identical 400 — distinguishing them would tell whoever holds a credential exactly what
 * is wrong with it, which is the same enumeration risk `LoginService` closes for passwords.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly repository: EmailVerificationRepository,
    private readonly users: AuthRepository,
    @Inject(AuthTokens.EmailSender) private readonly email: EmailSender,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(EmailVerificationService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * base64url SHA-256 of a raw credential. Kept as a public static because sub-project 2's suite
   * and the e2e fixtures call it by this name; the implementation is the shared helper.
   */
  static hashCredential(raw: string): string {
    return hashCredential(raw);
  }

  /**
   * Mints a fresh token and code, stores only their hashes, and mails both. Never throws: the
   * caller is mid-registration (or mid-resend) and a mail failure must not undo an account
   * that already exists.
   */
  async issueFor(user: User): Promise<void> {
    try {
      const token = randomBytes(AuthConstants.EmailVerificationTokenBytes).toString('base64url');
      const code = generateCode(AuthConstants.EmailVerificationCodeDigits);
      const ttlHours = this.config.get('EMAIL_VERIFICATION_TTL_HOURS', { infer: true });
      const expiresAt = new Date(Date.now() + ttlHours * 60 * AuthConstants.MillisecondsPerMinute);

      const created = await this.repository.create({
        userId: user.id,
        email: user.email,
        tokenHash: hashCredential(token),
        codeHash: hashCredential(code),
        expiresAt,
      });

      if (!created) {
        // A credential that was emailed but never stored can never be honoured — do not mail it.
        this.logger.error(
          { userId: user.id },
          'Verification record could not be stored; not mailing',
        );
        return;
      }

      const baseUrl = this.config.get('APP_PUBLIC_BASE_URL', { infer: true });

      await this.email.send(
        buildVerificationEmail({
          to: created.email,
          fullName: user.fullName ?? '',
          link: `${baseUrl}/verify-email?token=${token}`,
          code,
          ttlHours,
        }),
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.id },
        'Exception occurred in EmailVerificationService.issueFor',
      );
    }
  }

  /**
   * Verifies a link token or an email+code pair.
   *
   * A code alone is refused — resolving it needs the email to know which record to check, and
   * accepting the code without it would mean guessing against every live record in the table.
   */
  async verify(input: VerifyEmailInput): Promise<ServiceResponse<void>> {
    try {
      if (input.token) {
        return await this.verifyByToken(input.token);
      }

      if (input.email && input.code) {
        return await this.verifyByCode(input.email, input.code);
      }

      return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.VerificationInvalid);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in EmailVerificationService.verify');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Resends a verification credential. Always answers `ok`: an unknown address, a database
   * fault, and an already-verified address must all look identical from here, or the response
   * becomes an oracle for which addresses have accounts.
   */
  async resend(email: string): Promise<ServiceResponse<void>> {
    try {
      const user = await this.users.findByEmail(email);

      if (!user || user.emailVerifiedAt !== null) {
        return serviceOk<void>(undefined);
      }

      const latest = await this.repository.findNewestLiveForEmail(email);

      if (latest === null) {
        // Same reasoning as the fault above: minting a second live credential while the store
        // cannot even confirm whether one already exists is the wrong direction to guess in.
        this.logger.error(
          { userId: user.id },
          'Could not check the resend cooldown; resend skipped',
        );
        return serviceOk<void>(undefined);
      }

      if (
        latest &&
        withinCooldown(latest.createdAt, AuthConstants.EmailVerificationResendCooldownSeconds)
      ) {
        return serviceOk<void>(undefined);
      }

      await this.repository.consumeAllForUser(user.id);
      await this.issueFor(user);

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in EmailVerificationService.resend');
      return serviceOk<void>(undefined);
    }
  }

  private async verifyByToken(token: string): Promise<ServiceResponse<void>> {
    const found = await this.repository.findByTokenHash(hashCredential(token));

    if (found === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (!isLive(found)) {
      return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.VerificationInvalid);
    }

    return this.complete(found);
  }

  private async verifyByCode(email: string, code: string): Promise<ServiceResponse<void>> {
    const found = await this.repository.findNewestLiveForEmail(email);

    if (found === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (!isLive(found)) {
      return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.VerificationInvalid);
    }

    // The attempt cap is checked before the code is even compared: a record at the cap is
    // already dead, so there is nothing to time-safe-compare against.
    if (found.attempts >= AuthConstants.EmailVerificationMaxAttempts) {
      return serviceFail(HttpStatus.TOO_MANY_REQUESTS, AuthMessages.VerificationTooManyAttempts);
    }

    if (!codeMatches(code, found.codeHash)) {
      return this.registerWrongCode(found.id);
    }

    return this.complete(found);
  }

  /**
   * Atomically increments the attempt counter and answers accordingly.
   *
   * Fails closed: when the increment cannot be confirmed, the response is 503 — never the 400
   * that would let the caller keep guessing against a counter that may not have actually
   * advanced in storage. When it can be confirmed, the cap decision uses the count the database
   * just returned rather than arithmetic done here, so a guess that reaches the cap answers 429
   * immediately instead of waiting for a subsequent call to notice.
   */
  private async registerWrongCode(id: string): Promise<ServiceResponse<void>> {
    const attempts = await this.repository.incrementAttempts(id);

    if (attempts === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (attempts >= AuthConstants.EmailVerificationMaxAttempts) {
      return serviceFail(HttpStatus.TOO_MANY_REQUESTS, AuthMessages.VerificationTooManyAttempts);
    }

    return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.VerificationInvalid);
  }

  /** Sets `emailVerifiedAt`, closes every live record for the account, and mails confirmation. */
  private async complete(record: EmailVerificationWithUser): Promise<ServiceResponse<void>> {
    const updated = await this.users.updateEmailVerifiedAt(record.userId);
    if (!updated) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    await this.repository.consumeAllForUser(record.userId);
    await this.email.send(
      buildVerifiedEmail({ to: record.email, fullName: record.user.fullName ?? '' }),
    );

    return serviceOk<void>(undefined);
  }
}

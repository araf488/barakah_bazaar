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
import { buildPasswordResetEmail } from '../emails/password-emails';
import { PasswordUpdater } from '../passwords/password-updater';
import { PasswordResetRepository, PasswordResetWithUser } from './password-reset.repository';

/** What `reset` accepts: a link token alone, or an email paired with a typed-in code. */
export interface ResetPasswordInput {
  readonly token?: string;
  readonly email?: string;
  readonly code?: string;
  readonly newPassword: string;
}

/**
 * Mints, mails and redeems the password-reset credential.
 *
 * **A completed reset returns no session.** Staff accounts require a second factor, so a reset
 * that handed back a session would let anyone holding a reset credential into a staff account
 * without it. That would make password reset a complete MFA bypass. The flow ends at "your
 * password is changed, sign in". A later "usability improvement" that returns a session here
 * removes the second factor for every staff account. Do not make it.
 *
 * Unknown, expired, consumed and wrong credentials all answer the identical 400, for the same
 * enumeration reason `EmailVerificationService` gives.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly repository: PasswordResetRepository,
    private readonly users: AuthRepository,
    private readonly updater: PasswordUpdater,
    @Inject(AuthTokens.EmailSender) private readonly email: EmailSender,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(PasswordResetService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Sends a reset credential to the address, if it may have one. **Always answers `ok`**: an
   * unknown address, a disabled account, a pending invitation, a cooldown and a database fault
   * must all look identical, or the response becomes an oracle for which addresses have
   * accounts. A 429 for the cooldown would reveal that the previous request found one.
   *
   * **The response waits for the account lookup and nothing else.** Everything after it (the
   * cooldown read, closing earlier records, storing the new one, and the SMTP round trip) runs in
   * `issueInBackground`, not awaited. Awaited, that work made a known address answer hundreds of
   * milliseconds slower than an unknown one, and the latency alone told a caller which addresses
   * have accounts (spec §6.2).
   */
  async request(email: string): Promise<ServiceResponse<void>> {
    try {
      const user = await this.users.findByEmail(email);

      if (user === null) {
        this.logger.error('Could not look up the account for a reset request; nothing sent');
        return serviceOk<void>(undefined);
      }

      if (PasswordResetService.mayReset(user)) {
        // Deliberately not awaited: see above. issueInBackground never rejects.
        void this.issueInBackground(user);
      }

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PasswordResetService.request');
      return serviceOk<void>(undefined);
    }
  }

  /**
   * The part of `request` the caller must not be able to time. Fails closed at every step: a
   * cooldown that cannot be read, or earlier records that cannot be closed, send nothing. Never
   * rejects, because nobody awaits it to catch the rejection.
   */
  private async issueInBackground(user: User): Promise<void> {
    try {
      // By the stored address, not the submitted one: the account lookup is case-insensitive,
      // and the reset rows were written lower-cased from the stored address.
      const latest = await this.repository.findNewestLiveForEmail(user.email);

      if (latest === null) {
        // Minting a second live credential while the store cannot say whether one already
        // exists is the wrong direction to guess in.
        this.logger.error({ userId: user.id }, 'Could not check the reset cooldown; nothing sent');
        return;
      }

      if (
        latest &&
        withinCooldown(latest.createdAt, AuthConstants.PasswordResetRequestCooldownSeconds)
      ) {
        return;
      }

      // Only the newest email works: every earlier credential dies before the new one exists.
      const closed = await this.repository.consumeAllForUser(user.id);

      if (closed === null) {
        // Issuing now would leave every earlier link redeemable beside the new one.
        this.logger.error(
          { userId: user.id },
          'Could not close earlier reset records; nothing sent',
        );
        return;
      }

      await this.issue(user);
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.id },
        'Exception occurred in PasswordResetService.issueInBackground',
      );
    }
  }

  /**
   * Redeems a link token or an email+code pair and sets the new password. Returns no data at
   * all on success: see the class comment.
   */
  async reset(input: ResetPasswordInput): Promise<ServiceResponse<void>> {
    try {
      const found = await this.resolveRecord(input);
      if (!found.ok) {
        return found;
      }

      // Rechecked at redemption, not only at issue: a record issued before an admin disabled the
      // account, or before it lost its password, must not be redeemable. The identical 400, so
      // this adds no oracle for the account's state.
      if (!PasswordResetService.mayReset(found.data.user)) {
        return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.ResetInvalid);
      }

      return await this.complete(found.data, input.newPassword);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PasswordResetService.reset');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * An account that may receive a reset: enabled, and already holding a password. A row with
   * no password is a pending staff invitation. Setting its first password is the invitation
   * flow's job, and doing it here would activate an invitation an admin may have revoked.
   */
  private static mayReset(user: User | undefined): user is User {
    return user !== undefined && user.isActive && user.passwordHash !== null;
  }

  private async issue(user: User): Promise<void> {
    const token = randomBytes(AuthConstants.PasswordResetTokenBytes).toString('base64url');
    const code = generateCode(AuthConstants.PasswordResetCodeDigits);
    const ttlMinutes = this.config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true });

    const created = await this.repository.create({
      userId: user.id,
      email: user.email,
      tokenHash: hashCredential(token),
      codeHash: hashCredential(code),
      expiresAt: new Date(Date.now() + ttlMinutes * AuthConstants.MillisecondsPerMinute),
    });

    if (!created) {
      // A credential that was emailed but never stored can never be honoured — do not mail it.
      this.logger.error({ userId: user.id }, 'Reset record could not be stored; not mailing');
      return;
    }

    // From config, never from the request's Host header: a Host-derived link turns every reset
    // email into a redirect an attacker controls, carrying the credential to them.
    const baseUrl = this.config.get('APP_PUBLIC_BASE_URL', { infer: true });

    await this.email.send(
      buildPasswordResetEmail({
        to: created.email,
        fullName: user.fullName ?? '',
        link: `${baseUrl}${AuthConstants.PasswordResetLinkPath}?token=${token}`,
        code,
        ttlMinutes,
      }),
    );
  }

  /**
   * A code alone is refused. Resolving it needs the email to know which record to check, and
   * accepting the code without it would mean guessing against every live record in the table.
   */
  private resolveRecord(
    input: ResetPasswordInput,
  ): Promise<ServiceResponse<PasswordResetWithUser>> {
    if (input.token) {
      return this.resolveByToken(input.token);
    }

    if (input.email && input.code) {
      return this.resolveByCode(input.email, input.code);
    }

    return Promise.resolve(serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.ResetInvalid));
  }

  private async resolveByToken(token: string): Promise<ServiceResponse<PasswordResetWithUser>> {
    const found = await this.repository.findByTokenHash(hashCredential(token));

    if (found === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (!isLive(found)) {
      return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.ResetInvalid);
    }

    return serviceOk(found);
  }

  private async resolveByCode(
    email: string,
    code: string,
  ): Promise<ServiceResponse<PasswordResetWithUser>> {
    const found = await this.repository.findNewestLiveForEmail(email);

    if (found === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (!isLive(found)) {
      return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.ResetInvalid);
    }

    // Before the comparison: a caller at the cap must learn nothing about their guess.
    if (found.attempts >= AuthConstants.PasswordResetMaxAttempts) {
      return serviceFail(HttpStatus.TOO_MANY_REQUESTS, AuthMessages.ResetTooManyAttempts);
    }

    if (!codeMatches(code, found.codeHash)) {
      return this.registerWrongCode(found.id);
    }

    return serviceOk(found);
  }

  /**
   * Atomically counts a wrong code. Fails closed: an unconfirmed increment answers 503, never
   * the 400 that would let the caller keep guessing against a counter that may not have moved.
   * The cap decision uses the count the database returned.
   */
  private async registerWrongCode(id: string): Promise<ServiceResponse<PasswordResetWithUser>> {
    const attempts = await this.repository.incrementAttempts(id);

    if (attempts === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (attempts >= AuthConstants.PasswordResetMaxAttempts) {
      return serviceFail(HttpStatus.TOO_MANY_REQUESTS, AuthMessages.ResetTooManyAttempts);
    }

    return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.ResetInvalid);
  }

  /**
   * Spec §5.2's order: revoke and write (inside `replace`), consume, verify the address,
   * announce. Wrapped in a claim on this one record, so two concurrent redemptions cannot both
   * write a password: the loser of the claim gets the same 400 as a used credential.
   */
  private async complete(
    record: PasswordResetWithUser,
    newPassword: string,
  ): Promise<ServiceResponse<void>> {
    const claimed = await this.claimRecord(record.id);
    if (!claimed.ok) {
      return claimed;
    }

    const replaced = await this.replaceUnderClaim(record, claimed.data, newPassword);
    if (!replaced.ok) {
      return replaced;
    }

    await this.finishReset(record);

    return serviceOk<void>(undefined);
  }

  /** Takes the record for this redemption. Lost the race: 400. Could not tell: 503. */
  private async claimRecord(id: string): Promise<ServiceResponse<Date>> {
    const claimedAt = await this.repository.claim(id);

    if (claimedAt === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (claimedAt === undefined) {
      return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.ResetInvalid);
    }

    return serviceOk(claimedAt);
  }

  /**
   * Replaces the password while holding the claim. A failed `replace` hands the claim back, so a
   * weak-password refusal leaves the credential usable for the retry.
   */
  private async replaceUnderClaim(
    record: PasswordResetWithUser,
    claimedAt: Date,
    newPassword: string,
  ): Promise<ServiceResponse<void>> {
    const replaced = await this.updater.replace(record.user, newPassword);
    if (replaced.ok) {
      return replaced;
    }

    const released = await this.repository.release(record.id, claimedAt);
    if (released === null) {
      // The caller still gets replace's own answer. The credential is now dead until it
      // expires, and the owner has to request another.
      this.logger.error(
        { userId: record.userId, passwordResetId: record.id },
        'Could not release a claimed reset record after a failed replace',
      );
    }

    return replaced;
  }

  /** What follows a written password. None of it can fail the reset: the password has changed. */
  private async finishReset(record: PasswordResetWithUser): Promise<void> {
    // Any other live record for the account dies too; the claimed one is already consumed.
    const consumed = await this.repository.consumeAllForUser(record.userId);
    if (consumed === null) {
      // The password has changed and the sessions are gone, so this is not the caller's
      // failure. But other records stay redeemable until they expire, and someone should know.
      this.logger.error(
        { userId: record.userId },
        'Reset records could not be consumed after a completed reset',
      );
    }

    // Completing a reset needed a credential mailed to this address — the proof email
    // verification asks for. Asking again would be asking to prove what was just proved.
    if (record.user.emailVerifiedAt === null) {
      await this.users.updateEmailVerifiedAt(record.userId);
    }

    await this.updater.announce(record.user);
  }
}

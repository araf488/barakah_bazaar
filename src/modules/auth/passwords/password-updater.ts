import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../../common/types/service-response';
import { User } from '../../../infra/prisma/prisma-client';
import { EmailSender } from '../../notification/ports/email-sender.port';
import { AuthTokens } from '../auth.constants';
import { AuthEventsService } from '../auth-events.service';
import { AuthRepository } from '../auth.repository';
import { PasswordHasher } from '../crypto/password-hasher';
import { buildPasswordChangedEmail } from '../emails/password-emails';
import { SessionService } from '../sessions/session.service';
import { PasswordPolicy } from './password-policy';

/**
 * What a password reset and a password change have in common: judging the new password,
 * ending sessions, writing the hash, and telling the owner.
 *
 * Only the identical part is here. Everything else stays in its own flow: the reset consumes a
 * credential and may verify the address, and the change verifies the current password first.
 *
 * At the S107 ceiling of 7 constructor parameters. A new collaborator splits `announce` (events
 * and email) into its own class rather than pushing this to 8.
 */
@Injectable()
export class PasswordUpdater {
  constructor(
    private readonly users: AuthRepository,
    private readonly sessions: SessionService,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly events: AuthEventsService,
    @Inject(AuthTokens.EmailSender) private readonly email: EmailSender,
    @InjectPinoLogger(PasswordUpdater.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Replaces the password: policy, then hash, then revoke, then write, then revoke again.
   *
   * **Revocation precedes the write, and the order is a security decision.** Write-then-revoke,
   * with the revoke failing, leaves a session opened under the old password alive across the
   * very change made to remove it. Revoke-then-write, with the write failing, signs the owner
   * out with the password unchanged: annoying, recoverable, and nobody gains anything. A
   * revocation that cannot be confirmed therefore stops everything with 503.
   *
   * **The second revoke, after the write, closes a race with login.** `LoginService` reads the
   * hash, spends ~100 ms in scrypt, then inserts a session, and never rechecks. A login that read
   * the old hash before the write and inserted its session after the first revoke would survive
   * the change. Revoking again once the write is done kills that session. If the second revoke
   * fails it is logged and the change still answers ok: the first revoke succeeded and the
   * password is already written, so refusing now would only invite a retry of a done change.
   *
   * **Known remaining gap:** a login whose scrypt finishes *after* the second revoke, having read
   * the old hash before the write, still gets a session. Closing it needs login to refuse a
   * session for a hash read before `passwordChangedAt`, a tracked follow-up outside this class.
   *
   * `keepSessionId` absent revokes every session (a reset). Present, it revokes every other
   * session and keeps that one (a change made from a signed-in device).
   */
  async replace(
    user: User,
    newPassword: string,
    keepSessionId?: string,
  ): Promise<ServiceResponse<void>> {
    try {
      const policyFailure = this.policy.check(newPassword, {
        email: user.email,
        fullName: user.fullName,
      });

      if (policyFailure) {
        return serviceFail(HttpStatus.BAD_REQUEST, policyFailure);
      }

      const passwordHash = await this.hasher.hash(newPassword);

      const revoked = await this.revokeSessions(user.id, keepSessionId);
      if (!revoked.ok) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const updated = await this.users.updatePasswordHash(user.id, passwordHash);
      if (!updated) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const revokedAgain = await this.revokeSessions(user.id, keepSessionId);
      if (!revokedAgain.ok) {
        this.logger.error(
          { userId: user.id },
          'Could not repeat session revocation after a password write; password is changed',
        );
      }

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.id },
        'Exception occurred in PasswordUpdater.replace',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Records `auth.password_changed` (staff only, by `AuthEventsService`'s own rule) and mails
   * the owner a credential-free notice. Never fails the caller: by the time this runs the
   * password has changed, and an unreachable audit table or mail relay must not turn that into
   * an error the client retries.
   */
  async announce(user: User): Promise<void> {
    try {
      await this.events.recordPasswordChanged(user);
      await this.email.send(
        buildPasswordChangedEmail({ to: user.email, fullName: user.fullName ?? '' }),
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.id },
        'Exception occurred in PasswordUpdater.announce',
      );
    }
  }

  private revokeSessions(
    userId: string,
    keepSessionId: string | undefined,
  ): Promise<ServiceResponse<number>> {
    return keepSessionId === undefined
      ? this.sessions.revokeAll(userId)
      : this.sessions.revokeAllExcept(userId, keepSessionId);
  }
}

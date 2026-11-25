import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { StaffInvitation, StaffInvitationStatus, User } from '../../infra/prisma/prisma-client';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { PasswordPolicy } from '../auth/passwords/password-policy';
import { AdminAuditActions, AdminAuditEntities, AdminMessages } from './admin.constants';
import { AuditLogWriteData } from './audit-log.repository';
import { AcceptInvitationDto, InvitationAcceptedDto } from './dto/staff-invitation.dto';
import { invitationAuditJson } from './staff-invitation.audit';
import { AcceptResult, StaffInvitationRepository } from './staff-invitation.repository';
import { hashInvitationToken } from './staff-invitation.token';

/**
 * Taking up a staff invitation by creating the account it offers.
 *
 * The invitee has no account yet, so nothing here is authenticated: possession of the emailed
 * token is the whole proof, which is why the token is only ever looked up by its hash and never
 * logged.
 */
@Injectable()
export class StaffInvitationAcceptService {
  constructor(
    private readonly repository: StaffInvitationRepository,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    @InjectPinoLogger(StaffInvitationAcceptService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Takes up an invitation by creating the staff account it offers.
   *
   * **Returns no session, and must never be changed to.** Staff accounts require a second
   * factor; a session handed back here would let anyone holding an invitation link into a staff
   * account without it. The new staff member signs in and enrols TOTP like everyone else.
   *
   * Nothing is written before the password policy passes, so a weak password leaves the
   * invitation open and the same link works for the retry.
   */
  async accept(dto: AcceptInvitationDto): Promise<ServiceResponse<InvitationAcceptedDto>> {
    try {
      const fullName = dto.fullName.trim();
      const invitation = await this.repository.findByTokenHash(hashInvitationToken(dto.token));
      const usable = StaffInvitationAcceptService.assertUsable(invitation);
      if (usable) {
        return usable;
      }
      const open = invitation as StaffInvitation;

      const policyFailure = this.policy.check(dto.password, {
        email: open.email,
        fullName,
      });
      if (policyFailure) {
        return serviceFail(HttpStatus.BAD_REQUEST, policyFailure);
      }

      const passwordHash = await this.hasher.hash(dto.password);
      const result = await this.repository.acceptCreatingAccount(
        open,
        { passwordHash, fullName },
        (updated, user) => StaffInvitationAcceptService.auditRow(updated, open, user),
      );

      return StaffInvitationAcceptService.toResponse(result);
    } catch (error) {
      // Neither the token nor the password is logged: both are live credentials.
      this.logger.error(
        { err: error },
        'Exception occurred in StaffInvitationAcceptService.accept',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Every reason an invitation cannot be taken up, in the order that leaks the least.
   *
   * A bad token and a revoked one answer identically, so the endpoint cannot be used to
   * discover which tokens exist.
   */
  private static assertUsable(
    invitation: StaffInvitation | null | undefined,
  ): ServiceResponse<never> | null {
    if (invitation === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (invitation === undefined || invitation.status !== StaffInvitationStatus.PENDING) {
      return serviceFail(HttpStatus.NOT_FOUND, AdminMessages.InvitationInvalid);
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      return serviceFail(HttpStatus.GONE, AdminMessages.InvitationExpired);
    }

    return null;
  }

  private static toResponse(result: AcceptResult): ServiceResponse<InvitationAcceptedDto> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    switch (result.kind) {
      case 'not-pending':
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationNotPending);
      case 'account-exists':
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationAccountExists);
      case 'accepted':
        return serviceOk({ accepted: true });
      default: {
        // Exhaustive: a new AcceptResult kind fails to compile here until it is handled.
        result satisfies never;
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }
    }
  }

  /**
   * The audit row for an acceptance, with the new account as the actor.
   *
   * `user` is the full row the transaction created, password hash included, so only its id,
   * email and role are picked out. It must never be spread or serialised into the trail.
   */
  private static auditRow(
    updated: StaffInvitation,
    before: StaffInvitation,
    user: User,
  ): AuditLogWriteData {
    return {
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: AdminAuditActions.StaffInvitationAccepted,
      entityType: AdminAuditEntities.StaffInvitation,
      entityId: updated.id,
      before: invitationAuditJson(before),
      after: invitationAuditJson(updated),
      requestId: null,
    };
  }
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import {
  Prisma,
  StaffInvitation,
  StaffInvitationStatus,
  UserRole,
} from '../../infra/prisma/prisma-client';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../../config';
import { AuthRepository } from '../auth/auth.repository';
import { EmailSender } from '../notification/ports/email-sender.port';
import {
  AdminAuditActions,
  AdminAuditEntities,
  AdminConstants,
  AdminMessages,
  AdminTokens,
} from './admin.constants';
import { AuditLogWriteData } from './audit-log.repository';
import { invitationAuditJson } from './staff-invitation.audit';
import { StaffInvitationRepository } from './staff-invitation.repository';
import { hashInvitationToken } from './staff-invitation.token';
import { StaffInvitationMapper } from './staff-invitation.mapper';
import {
  InvitationCreatedDto,
  InvitationListDto,
  InvitationQueryDto,
  InviteStaffDto,
  StaffInvitationDto,
} from './dto/staff-invitation.dto';

/** The staff member performing the action, resolved from their token. */
interface Actor {
  readonly id: string;
  readonly email: string | null;
  readonly role: UserRole;
}

/**
 * Offering a staff role to someone who does not have an account yet.
 *
 * The token is a **bearer credential that grants a permission**, and is handled like one:
 * 32 bytes of entropy, only its SHA-256 stored, and never logged or returned once created.
 * A leaked table dump must not hand anyone a working grant.
 *
 * Taking an invitation up is `StaffInvitationAcceptService`'s job: it creates the invitee's
 * account, so it runs before anyone is signed in.
 */
@Injectable()
export class StaffInvitationService {
  constructor(
    private readonly repository: StaffInvitationRepository,
    private readonly users: AuthRepository,
    @Inject(AdminTokens.EmailSender) private readonly email: EmailSender,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(StaffInvitationService.name) private readonly logger: PinoLogger,
  ) {}

  async invite(
    actor: AuthenticatedUser,
    dto: InviteStaffDto,
  ): Promise<ServiceResponse<InvitationCreatedDto>> {
    try {
      const inviter = await this.resolveActor(actor);
      if (!inviter.ok) {
        return inviter;
      }

      const email = dto.email.toLowerCase();

      const conflict = await this.assertInvitable(email);
      if (conflict) {
        return conflict;
      }

      const token = randomBytes(AdminConstants.InvitationTokenBytes).toString('base64url');

      const created = await this.repository.createAudited(
        {
          email,
          role: dto.role,
          tokenHash: hashInvitationToken(token),
          expiresAt: StaffInvitationService.deadline(),
          invitedBy: inviter.data.id,
        },
        (row) =>
          StaffInvitationService.audit(
            inviter.data,
            AdminAuditActions.StaffInvited,
            row,
            null,
            row,
          ),
      );

      if (!created) {
        // The invitation and its audit row roll back together, so nothing was granted.
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
      }

      return serviceOk(await this.deliver(created, token));
    } catch (error) {
      // The token is never included: it is a live credential even in an error path.
      this.logger.error(
        { err: error, email: dto.email },
        'Exception occurred in StaffInvitationService.invite',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Withdraws an invitation that has not been taken up. */
  async revoke(
    actor: AuthenticatedUser,
    invitationId: string,
  ): Promise<ServiceResponse<StaffInvitationDto>> {
    try {
      const revoker = await this.resolveActor(actor);
      if (!revoker.ok) {
        return revoker;
      }

      const invitation = await this.repository.findById(invitationId);

      if (invitation === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (invitation === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, AdminConstants.InvitationResourceName),
        );
      }

      if (invitation.status !== StaffInvitationStatus.PENDING) {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationNotPending);
      }

      const revoked = await this.repository.settleAudited(
        invitation.id,
        {
          status: StaffInvitationStatus.REVOKED,
          revokedBy: revoker.data.id,
          revokedAt: new Date(),
        },
        (row) =>
          StaffInvitationService.audit(
            revoker.data,
            AdminAuditActions.StaffInvitationRevoked,
            row,
            invitation,
            row,
          ),
      );

      if (!revoked) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
      }

      if (revoked.kind === 'not-pending') {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationNotPending);
      }

      return serviceOk(StaffInvitationMapper.toDto(revoked.invitation));
    } catch (error) {
      this.logger.error(
        { err: error, invitationId },
        'Exception occurred in StaffInvitationService.revoke',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Issues a fresh link for an open invitation: the token is rotated, so the old link dies, and
   * the deadline restarts. An expired but still PENDING invitation can be resent.
   */
  async resend(
    actor: AuthenticatedUser,
    invitationId: string,
  ): Promise<ServiceResponse<InvitationCreatedDto>> {
    try {
      const sender = await this.resolveActor(actor);
      if (!sender.ok) {
        return sender;
      }

      const invitation = await this.repository.findById(invitationId);

      if (invitation === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (invitation === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, AdminConstants.InvitationResourceName),
        );
      }

      if (invitation.status !== StaffInvitationStatus.PENDING) {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationNotPending);
      }

      const token = randomBytes(AdminConstants.InvitationTokenBytes).toString('base64url');

      const updated = await this.repository.resendAudited(
        invitation.id,
        { tokenHash: hashInvitationToken(token), expiresAt: StaffInvitationService.deadline() },
        (row) =>
          StaffInvitationService.audit(
            sender.data,
            AdminAuditActions.StaffInvitationResent,
            row,
            invitation,
            row,
          ),
      );

      if (!updated) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
      }

      if (updated.kind === 'not-pending') {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationNotPending);
      }

      return serviceOk(await this.deliver(updated.invitation, token));
    } catch (error) {
      // The token is never included: it is a live credential even in an error path.
      this.logger.error(
        { err: error, invitationId },
        'Exception occurred in StaffInvitationService.resend',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async list(query: InvitationQueryDto): Promise<ServiceResponse<InvitationListDto>> {
    try {
      const take = query.pageSize ?? AdminConstants.MaxInvitationPageSize;
      const page = query.page ?? 1;
      const where: Prisma.StaffInvitationWhereInput = query.status ? { status: query.status } : {};

      const result = await this.repository.findPage(where, (page - 1) * take, take);

      if (result === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk({
        items: result.items.map((row) => StaffInvitationMapper.toDto(row)),
        total: result.total,
        page,
        pageSize: take,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in StaffInvitationService.list');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Sends the email, and surfaces the raw token only while no provider is configured. */
  private async deliver(invitation: StaffInvitation, token: string): Promise<InvitationCreatedDto> {
    const sent = await this.email
      .send({
        to: invitation.email,
        subject: AdminConstants.InvitationEmailSubject,
        body: formatMessage(
          AdminConstants.InvitationEmailTemplate,
          invitation.role,
          this.acceptLink(token),
          String(AdminConstants.InvitationValidDays),
        ),
      })
      .catch((error: unknown) => {
        // A send failure does not undo the invitation: it exists, it is auditable, and it can
        // be revoked and reissued. Throwing here would leave a granted-but-unreported row.
        this.logger.error(
          { err: error, invitationId: invitation.id },
          'Invitation created but the email could not be sent',
        );
        return false;
      });

    return {
      invitation: StaffInvitationMapper.toDto(invitation),
      emailSent: sent,
      token: this.isEmailDisabled() ? token : null,
    };
  }

  /** The link the invitee opens; the raw token rides only in its query string. */
  private acceptLink(token: string): string {
    return `${this.config.get('APP_PUBLIC_BASE_URL', { infer: true })}${AdminConstants.InvitationAcceptPath}?token=${token}`;
  }

  /**
   * True only when the operator has deliberately turned email off.
   *
   * Read from configuration rather than sniffed off the bound adapter's class name. The class
   * check silently answered "yes" whenever the noop adapter happened to be bound — which, back
   * when EMAIL_PROVIDER was declared but never read, was always. The raw token was therefore
   * returned in the API response in every environment, including ones the operator had
   * configured for real email.
   *
   * The safe direction: with a provider set, the token never leaves the email, even if that
   * provider turns out to have no adapter and the send fails. An invitation nobody received is
   * recoverable — a bearer credential in an API response is not.
   */
  private isEmailDisabled(): boolean {
    return this.config.get('EMAIL_PROVIDER', { infer: true }) === 'noop';
  }

  /** Refuses an address that already has an account or an open invitation. */
  private async assertInvitable(email: string): Promise<ServiceResponse<never> | null> {
    const existing = await this.users.findByEmail(email);

    if (existing === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (existing) {
      // Two paths to the same state invite drift. Changing a role is the other endpoint.
      return serviceFail(HttpStatus.CONFLICT, AdminMessages.InviteeAlreadyExists);
    }

    const open = await this.repository.findOpenForEmail(email);

    if (open === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (open && open.expiresAt.getTime() > Date.now()) {
      return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationAlreadyOpen);
    }

    return null;
  }

  private async resolveActor(user: AuthenticatedUser): Promise<ServiceResponse<Actor>> {
    const account = await this.users.findById(user.userId);

    if (account === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (account === undefined) {
      return serviceFail(
        HttpStatus.NOT_FOUND,
        formatMessage(ErrorMessageTemplates.NotFound, AdminConstants.UserResourceName),
      );
    }

    return serviceOk({ id: account.id, email: account.email, role: account.role });
  }

  private static audit(
    actor: Actor,
    action: string,
    row: StaffInvitation,
    before: StaffInvitation | null,
    after: StaffInvitation,
  ): AuditLogWriteData {
    return {
      actorId: actor.id,
      // `Actor.email` is already `string | null` off the `users` row today, so this is
      // defensive rather than live — but it keeps this call site consistent with every other
      // audited write, all of which normalize a falsy actor email to `null` rather than
      // persisting `''`.
      actorEmail: actor.email || null,
      actorRole: actor.role,
      action,
      entityType: AdminAuditEntities.StaffInvitation,
      entityId: row.id,
      before: invitationAuditJson(before),
      after: invitationAuditJson(after),
      requestId: null,
    };
  }

  private static deadline(): Date {
    return new Date(Date.now() + AdminConstants.InvitationValidDays * 24 * 60 * 60 * 1000);
  }
}

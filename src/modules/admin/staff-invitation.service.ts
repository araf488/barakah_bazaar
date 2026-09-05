import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
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
  User,
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
import { StaffInvitationRepository } from './staff-invitation.repository';
import { StaffInvitationMapper } from './staff-invitation.mapper';
import {
  AcceptInvitationDto,
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
 * Acceptance additionally requires the signed-in account's email to match the invitation's.
 * Without that, the token alone would be enough and a forwarded invitation email would let
 * the wrong person take the role.
 *
 * The grant itself is one transaction: the invitation closes and the role lands on the
 * invitee's row together, because the `role` column is the only place a grant exists.
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
          tokenHash: StaffInvitationService.hash(token),
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

  /**
   * Takes up an invitation.
   *
   * Not a staff route: the invitee has no role yet, which is the whole point. It is
   * authenticated, though — the caller must already be signed in as the invited address.
   */
  async accept(
    user: AuthenticatedUser,
    dto: AcceptInvitationDto,
  ): Promise<ServiceResponse<StaffInvitationDto>> {
    try {
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

      const invitation = await this.repository.findByTokenHash(
        StaffInvitationService.hash(dto.token),
      );

      const usable = StaffInvitationService.assertUsable(invitation, account);
      if (usable) {
        return usable;
      }

      return await this.grant(invitation as StaffInvitation, account);
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.userId },
        'Exception occurred in StaffInvitationService.accept',
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
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationNotPending);
      }

      return serviceOk(StaffInvitationMapper.toDto(revoked));
    } catch (error) {
      this.logger.error(
        { err: error, invitationId },
        'Exception occurred in StaffInvitationService.revoke',
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

  /**
   * Closing the invitation and granting its role are one transaction — see
   * `StaffInvitationRepository.acceptAudited`. A failure therefore changes nothing, so the
   * caller can simply try again, and the answer is the same conflict a lost race gets.
   */
  private async grant(
    invitation: StaffInvitation,
    account: User,
  ): Promise<ServiceResponse<StaffInvitationDto>> {
    const settled = await this.repository.acceptAudited(
      invitation.id,
      {
        status: StaffInvitationStatus.ACCEPTED,
        acceptedBy: account.id,
        acceptedAt: new Date(),
      },
      { userId: account.id, role: invitation.role },
      (row) =>
        StaffInvitationService.audit(
          // The invitee is the actor here: they are the one taking the role.
          { id: account.id, email: account.email, role: invitation.role },
          AdminAuditActions.StaffInvitationAccepted,
          row,
          invitation,
          row,
        ),
    );

    if (!settled) {
      return serviceFail(HttpStatus.CONFLICT, AdminMessages.InvitationNotPending);
    }

    return serviceOk(StaffInvitationMapper.toDto(settled));
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
          token,
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

  /**
   * Every reason an invitation cannot be taken up, in the order that leaks the least.
   *
   * A bad token and a revoked one answer identically, so the endpoint cannot be used to
   * discover which tokens exist.
   */
  private static assertUsable(
    invitation: StaffInvitation | null | undefined,
    account: User,
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

    // The check that makes the token safe to email: possession alone is not enough.
    if (account.email.toLowerCase() !== invitation.email) {
      return serviceFail(HttpStatus.FORBIDDEN, AdminMessages.InvitationEmailMismatch);
    }

    return null;
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
      before: StaffInvitationService.toJson(before),
      after: StaffInvitationService.toJson(after),
      requestId: null,
    };
  }

  /**
   * Serialises for the trail with the token hash stripped and BigInts widened.
   *
   * The explicit replacer rather than the global hook `main.ts` installs, so this behaves
   * identically outside the bootstrap — the same reasoning as AuditLogService.toJson.
   */
  private static toJson(row: StaffInvitation | null): AuditLogWriteData['before'] {
    if (!row) {
      return undefined;
    }

    // An allowlist, not an omit: a future column added to this model must be chosen into the
    // trail deliberately rather than appearing in it by default. tokenHash is the credential
    // this exists to keep out.
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      invitedBy: row.invitedBy,
      acceptedBy: row.acceptedBy,
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      revokedBy: row.revokedBy,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private static deadline(): Date {
    return new Date(Date.now() + AdminConstants.InvitationValidDays * 24 * 60 * 60 * 1000);
  }
}

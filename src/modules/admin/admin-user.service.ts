import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Language, User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { PasswordResetService } from '../auth/password-reset/password-reset.service';
import {
  AdminAuditActions,
  AdminAuditEntities,
  AdminConstants,
  AdminMessages,
} from './admin.constants';
import { AdminMapper } from './admin.mapper';
import { AdminUserRepository } from './admin-user.repository';
import { AuditLogWriteData } from './audit-log.repository';
import {
  AdminUserDto,
  AdminUserQueryDto,
  ChangeRoleDto,
  CreateCustomerDto,
  CustomerCreatedDto,
} from './dto/admin-user.dto';

interface Actor {
  readonly id: string;
  readonly user: AuthenticatedUser;
}

/**
 * Staff-side account management.
 *
 * Two guards run before every mutation, and both exist to prevent lockout rather than to
 * enforce policy: a staff member may not act on their own account, and the last enabled
 * super admin may not be demoted or disabled. Without them one mistaken click leaves nobody
 * able to administer the system, recoverable only by hand-editing the database.
 */
@Injectable()
export class AdminUserService {
  constructor(
    private readonly repository: AdminUserRepository,
    private readonly authService: AuthService,
    private readonly hasher: PasswordHasher,
    private readonly passwordReset: PasswordResetService,
    private readonly users: AuthRepository,
    @InjectPinoLogger(AdminUserService.name) private readonly logger: PinoLogger,
  ) {}

  async listUsers(
    query: AdminUserQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<AdminUserDto>>> {
    try {
      const page = await this.repository.findPage(query);

      if (page === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(
        PaginatedResponseDto.of(
          AdminMapper.toAdminUsers(page.items),
          page.total,
          query.page,
          query.limit,
        ),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminUserService.listUsers');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Opens a customer account on someone's behalf.
   *
   * The account gets a random password nobody is ever told, so it cannot be signed into until
   * the customer chooses one through the ordinary password-reset email. The plaintext exists
   * only long enough to be hashed and is never kept or logged. The reset request runs after the
   * commit and its outcome is ignored: it never throws, and the account stands either way.
   */
  async createCustomer(
    user: AuthenticatedUser,
    dto: CreateCustomerDto,
  ): Promise<ServiceResponse<CustomerCreatedDto>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const email = dto.email.trim().toLowerCase();

      // Case-insensitive, and before the scrypt work: an existing address answers 409 cheaply.
      // The unique index still decides the lost race, below.
      const existing = await this.users.findByEmail(email);
      if (existing === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }
      if (existing !== undefined) {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.CustomerAlreadyExists);
      }

      const passwordHash = await this.hasher.hash(
        randomBytes(AdminConstants.PlaceholderPasswordBytes).toString('base64url'),
      );

      const result = await this.repository.createCustomerAudited(
        {
          email,
          fullName: dto.fullName.trim(),
          preferredLanguage: dto.preferredLanguage ?? Language.BN,
          passwordHash,
        },
        (created) =>
          AdminUserService.auditRow(actor.data, {
            action: AdminAuditActions.CustomerCreatedByStaff,
            entityId: created.id,
            before: undefined,
            after: AdminMapper.toAdminUser(created),
          }),
      );

      if (result === null) {
        // The create and its audit row rolled back together: the same answer every audited
        // write in this module gives, distinct from the lookup fault above.
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
      }

      if (result.kind === 'exists') {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.CustomerAlreadyExists);
      }

      await this.requestPasswordSetup(email);

      return serviceOk({
        user: AdminMapper.toAdminUser(result.user),
        passwordSetupEmailQueued: true,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminUserService.createCustomer');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Disables an account.
   *
   * Takes effect on the very next request: `AuthService` checks `isActive` against the
   * database every time, so a token already issued stops working immediately. That is why
   * this, and not a role change, is the tool for revoking access in a hurry.
   */
  async setAccountEnabled(
    user: AuthenticatedUser,
    targetId: string,
    enabled: boolean,
  ): Promise<ServiceResponse<AdminUserDto>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const target = await this.loadTarget(actor.data, targetId);
      if (!target.ok) {
        return target;
      }

      if (!enabled) {
        const lockout = await this.assertNotLastSuperAdmin(target.data);
        if (!lockout.ok) {
          return lockout;
        }
      }

      const updated = await this.repository.updateAudited(targetId, { isActive: enabled }, (row) =>
        AdminUserService.auditRow(actor.data, {
          action: enabled ? AdminAuditActions.CustomerEnabled : AdminAuditActions.CustomerDisabled,
          entityId: row.id,
          before: AdminMapper.toAdminUser(target.data),
          after: AdminMapper.toAdminUser(row),
        }),
      );

      return AdminUserService.written(updated);
    } catch (error) {
      this.logger.error(
        { err: error, targetId },
        'Exception occurred in AdminUserService.setAccountEnabled',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Changes a staff role.
   *
   * One write, and the `role` column is the whole of it: `SessionAuthGuard` reads the role
   * from that column on every request and no token carries a role claim, so there is no second
   * system to keep in step and no ordering to get right. The row and its audit entry commit in
   * one transaction, so a failure here changes nothing — there is no partial state to
   * reconcile, which is why this reports through the same `written` path as every other
   * account mutation.
   *
   * Takes effect on the caller's next request: the repository invalidates the session cache
   * for this user as part of the write.
   */
  async changeRole(
    user: AuthenticatedUser,
    targetId: string,
    dto: ChangeRoleDto,
  ): Promise<ServiceResponse<AdminUserDto>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const target = await this.loadTarget(actor.data, targetId);
      if (!target.ok) {
        return target;
      }

      if (target.data.role === dto.role) {
        return serviceOk(AdminMapper.toAdminUser(target.data));
      }

      if (target.data.role === UserRole.SUPER_ADMIN) {
        const lockout = await this.assertNotLastSuperAdmin(target.data);
        if (!lockout.ok) {
          return lockout;
        }
      }

      const updated = await this.repository.updateAudited(targetId, { role: dto.role }, (row) =>
        AdminUserService.auditRow(actor.data, {
          action: AdminAuditActions.StaffRoleChanged,
          entityId: row.id,
          before: AdminMapper.toAdminUser(target.data),
          after: AdminMapper.toAdminUser(row),
        }),
      );

      return AdminUserService.written(updated);
    } catch (error) {
      this.logger.error(
        { err: error, targetId },
        'Exception occurred in AdminUserService.changeRole',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Asks for the password-setup email once the account is committed. A failure here must never
   * turn that committed create into an error: staff would retry and meet a 409 on a live
   * account. The address is deliberately not logged.
   */
  private async requestPasswordSetup(email: string): Promise<void> {
    try {
      await this.passwordReset.request(email);
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Password setup request failed after customer creation; the account stands',
      );
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  private async resolveActor(user: AuthenticatedUser): Promise<ServiceResponse<Actor>> {
    const resolved = await this.authService.resolveActiveUserId(user);

    if (!resolved.ok) {
      return resolved;
    }

    return serviceOk({ id: resolved.data, user });
  }

  /** Loads the target and refuses when it is the caller's own account. */
  private async loadTarget(actor: Actor, targetId: string): Promise<ServiceResponse<User>> {
    if (targetId === actor.id) {
      return serviceFail(HttpStatus.FORBIDDEN, AdminMessages.CannotActOnSelf);
    }

    const target = await this.repository.findById(targetId);

    if (target === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (target === undefined) {
      return serviceFail(
        HttpStatus.NOT_FOUND,
        formatMessage(ErrorMessageTemplates.NotFound, AdminConstants.UserResourceName),
      );
    }

    return serviceOk(target);
  }

  private async assertNotLastSuperAdmin(target: User): Promise<ServiceResponse<void>> {
    if (target.role !== UserRole.SUPER_ADMIN || !target.isActive) {
      return serviceOk<void>(undefined);
    }

    const remaining = await this.repository.countActiveSuperAdmins();

    if (remaining === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (remaining <= 1) {
      return serviceFail(HttpStatus.CONFLICT, AdminMessages.LastSuperAdmin);
    }

    return serviceOk<void>(undefined);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Builds the audit row. `before`/`after` must be allowlisted DTOs, never raw `User` rows —
   * the row carries the password hash and the encrypted TOTP secret.
   */
  private static auditRow(
    actor: Actor,
    entry: { action: string; entityId: string; before: unknown; after: unknown },
  ): AuditLogWriteData {
    return {
      actorId: actor.id,
      actorEmail: actor.user.email ?? null,
      actorRole: actor.user.role,
      action: entry.action,
      entityType: AdminAuditEntities.User,
      entityId: entry.entityId,
      before: AdminUserService.toJson(entry.before),
      after: AdminUserService.toJson(entry.after),
      requestId: null,
    };
  }

  private static toJson(value: unknown): AuditLogWriteData['before'] {
    if (value === undefined || value === null) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? Number(item) : item,
      ),
    ) as AuditLogWriteData['before'];
  }

  private static written(result: User | null | undefined): ServiceResponse<AdminUserDto> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
    }

    if (result === undefined) {
      return serviceFail(
        HttpStatus.NOT_FOUND,
        formatMessage(ErrorMessageTemplates.NotFound, AdminConstants.UserResourceName),
      );
    }

    return serviceOk(AdminMapper.toAdminUser(result));
  }
}

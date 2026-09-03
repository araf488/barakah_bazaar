import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { User, UserRole } from '../../infra/prisma/prisma-client';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { AuthService } from '../auth/auth.service';
import {
  AdminAuditActions,
  AdminAuditEntities,
  AdminConstants,
  AdminMessages,
} from './admin.constants';
import { AdminMapper } from './admin.mapper';
import { AdminUserRepository } from './admin-user.repository';
import { AuditLogWriteData } from './audit-log.repository';
import { AdminUserDto, AdminUserQueryDto, ChangeRoleDto } from './dto/admin-user.dto';

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
    private readonly supabaseAdmin: SupabaseAdminService,
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
          before: target.data,
          after: row,
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
   * Supabase `app_metadata` is written FIRST, ahead of the local `role` column, purely for
   * which failure is survivable: the two writes cannot share a transaction, since one is an
   * HTTP call to another system. If Supabase fails, nothing changed locally either.
   *
   * SessionAuthGuard reads `role` straight from Postgres on every request — this application
   * trusts no other source for it — so if the *local* write fails after Supabase accepts, there
   * is no self-heal: the AUDIT ROW is lost and the column is stale until someone retries, which
   * is not survivable silently. That case logs everything needed to reconcile and tells the
   * operator plainly.
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

      const accepted = await this.supabaseAdmin.setUserRole(target.data.supabaseUserId, dto.role);

      if (!accepted) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.RoleChangeRejected);
      }

      return await this.mirrorRole(actor.data, target.data, dto.role);
    } catch (error) {
      this.logger.error(
        { err: error, targetId },
        'Exception occurred in AdminUserService.changeRole',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** The second half of the role change, after the identity provider accepted it. */
  private async mirrorRole(
    actor: Actor,
    target: User,
    role: UserRole,
  ): Promise<ServiceResponse<AdminUserDto>> {
    const updated = await this.repository.updateAudited(target.id, { role }, (row) =>
      AdminUserService.auditRow(actor, {
        action: AdminAuditActions.StaffRoleChanged,
        entityId: row.id,
        before: target,
        after: row,
      }),
    );

    if (!updated) {
      // Supabase is already authoritative for the new role. This is the line an operator
      // greps for to reconcile: everything needed to reconstruct the change is here.
      this.logger.error(
        {
          actorId: actor.id,
          targetId: target.id,
          supabaseUserId: target.supabaseUserId,
          previousRole: target.role,
          newRole: role,
        },
        'Role changed in Supabase but the local record and its audit row failed to write',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, AdminMessages.RoleChangePartial);
    }

    return serviceOk(AdminMapper.toAdminUser(updated));
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

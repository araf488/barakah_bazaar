import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AppConfigService } from '../../config';
import { AuthMessages, AuthTokens } from '../auth/auth.constants';
import { AuthService } from '../auth/auth.service';
import { SessionCachePort } from '../auth/sessions/session-cache.port';
import {
  AUTH_SETTINGS_FIELD_ORDER,
  ResolvedAuthSettings,
  checkAuthSettings,
} from '../auth/settings/auth-settings.rules';
import {
  AuthSettingsService,
  AuthSettingsWithFallbacks,
} from '../auth/settings/auth-settings.service';
import {
  AdminAuditAction,
  AdminAuditActions,
  AdminAuditEntities,
  AdminMessages,
} from './admin.constants';
import { AuditLogWriteData } from './audit-log.repository';
import { AuthSettingsAdminRepository } from './auth-settings-admin.repository';
import {
  AuthSettingsUpdatedDto,
  AuthSettingsViewDto,
  UpdateAuthSettingsDto,
} from './dto/auth-settings.dto';

/** The staff member performing the write, resolved from their token. */
interface Actor {
  readonly id: string;
  readonly user: AuthenticatedUser;
}

/**
 * Viewing and changing the auth settings from the backoffice.
 *
 * A PATCH is merged over the **effective** settings — what `resolveWithFallbacks()` says the
 * service is enforcing — and not over the raw stored row. A stored value that is invalid has
 * already fallen back to its default on the read path; merging over the raw row would make
 * every unrelated PATCH fail on a field the caller never touched, and the only way out would
 * be to hand-edit the database.
 *
 * The merged result is checked with the same `checkAuthSettings` the read path falls back by,
 * so a value this accepts is a value the read path keeps.
 *
 * The write is guarded on the `updatedAt` that the effective settings were read with
 * (optimistic concurrency). Each PATCH writes the whole merged row back, so without the guard
 * two concurrent PATCHes would be a lost update. A stale `staffMfaRequired: false` could then
 * silently re-disable staff MFA, with no confirmation flag and no `auth.staff_mfa_disabled`
 * audit action. The loser of the race gets a 409 and reloads.
 *
 * Turning `staffMfaRequired` from false to true also revokes every live staff session, in the
 * same transaction as the write and its audit row, so each staff member's next sign-in has to
 * pass the second factor. All staff, because `sessions` does not record whether MFA was used at
 * sign-in. That includes the acting super admin's own sessions. Each owner's session-cache
 * generation is bumped after the commit, so a cached session cannot outlive the revoke.
 *
 * After a successful write the local cache is dropped with `AuthSettingsService.invalidate()`.
 * Other instances keep their cached copy until it expires, which is why the answer reports
 * `propagatesWithinSeconds` (the `AUTH_SETTINGS_CACHE_SECONDS` window). The invalidate can race
 * an in-flight `current()` on this same instance that read the row just before the write: that
 * read may repopulate the cache with the old values after the invalidate. The staleness that
 * leaves is still bounded by the same cache window, which is exactly what
 * `propagatesWithinSeconds` already promises, so no generation counter is kept to close it.
 */
@Injectable()
export class AuthSettingsAdminService {
  constructor(
    private readonly repository: AuthSettingsAdminRepository,
    private readonly authSettings: AuthSettingsService,
    private readonly authService: AuthService,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @Inject(AuthTokens.SessionCache) private readonly sessionCache: SessionCachePort,
    @InjectPinoLogger(AuthSettingsAdminService.name) private readonly logger: PinoLogger,
  ) {}

  /** The effective settings, which fields fell back to their default, and the last write time. */
  async view(): Promise<ServiceResponse<AuthSettingsViewDto>> {
    try {
      const resolved = await this.authSettings.resolveWithFallbacks();

      if (resolved === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk({
        settings: resolved.settings,
        fallbacks: [...resolved.fallbacks],
        updatedAt: resolved.updatedAt,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsAdminService.view');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Merges the body over the effective settings, validates the result as a whole, and writes
   * it with its audit row. Turning staff MFA off needs `confirmDisableStaffMfa: true` and is
   * audited under its own action.
   */
  async update(
    user: AuthenticatedUser,
    dto: UpdateAuthSettingsDto,
  ): Promise<ServiceResponse<AuthSettingsUpdatedDto>> {
    try {
      const resolved = await this.authService.resolveActiveUserId(user);
      if (!resolved.ok) {
        return resolved;
      }

      const changes = AuthSettingsAdminService.changesIn(dto);
      if (Object.keys(changes).length === 0) {
        return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.NothingToChange);
      }

      const current = await this.authSettings.resolveWithFallbacks();
      if (current === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const effective = current.settings;
      const merged: ResolvedAuthSettings = { ...effective, ...changes };

      const refusal = AuthSettingsAdminService.refusalFor(effective, merged, dto);
      if (refusal !== null) {
        return refusal;
      }

      return await this.write({ id: resolved.data, user }, current, merged);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsAdminService.update');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Writes and audits, guarded on the `updatedAt` the effective settings were read with, then
   * drops the cache, but only once the write is known to have landed. A conflict (409) means
   * another write committed in between. Writing anyway would be a lost update that could
   * silently re-disable staff MFA (see `AuthSettingsAdminRepository.writeAudited`).
   */
  private async write(
    actor: Actor,
    current: AuthSettingsWithFallbacks,
    merged: ResolvedAuthSettings,
  ): Promise<ServiceResponse<AuthSettingsUpdatedDto>> {
    const effective = current.settings;
    const action = AuthSettingsAdminService.actionFor(effective, merged);
    const revokeStaffSessions = AuthSettingsAdminService.enablesStaffMfa(effective, merged);

    const result = await this.repository.writeAudited(
      merged,
      current.updatedAt,
      (row, revokedStaffSessions) =>
        AuthSettingsAdminService.auditRow(
          actor,
          action,
          row.id,
          current,
          merged,
          revokeStaffSessions ? revokedStaffSessions : null,
        ),
      { revokeStaffSessions },
    );

    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
    }

    if (result.kind === 'conflict') {
      return serviceFail(HttpStatus.CONFLICT, AdminMessages.SettingsChangedConcurrently);
    }

    if (revokeStaffSessions) {
      this.logger.info(
        { revokedStaffSessions: result.revokedStaffSessions },
        'Staff sessions revoked because staff MFA was turned back on',
      );
      await this.bumpSessionCaches(result.revokedStaffUserIds);
    }

    this.authSettings.invalidate();

    return serviceOk({
      settings: merged,
      propagatesWithinSeconds: this.config.get('AUTH_SETTINGS_CACHE_SECONDS', { infer: true }),
      staffSessionsRevoked: result.revokedStaffSessions,
    });
  }

  /**
   * Bumps the session-cache generation of every account whose sessions the write revoked, so a
   * session cached before the revoke is a miss on its next lookup instead of passing the guard
   * until its cache entry expires. The same per-user bump `SessionService.revokeAll` uses; the
   * cache has no cheaper global or per-role primitive.
   *
   * Runs after the commit and never fails the committed write: each bump is settled on its own,
   * a failure is logged at warn and the rest still run. The cache entry's TTL
   * (`SessionCacheTtlCeilingSeconds`) is the backstop for a bump that failed.
   */
  private async bumpSessionCaches(userIds: readonly string[]): Promise<void> {
    const outcomes = await Promise.allSettled(
      // async, so an adapter that throws synchronously becomes a rejection here too.
      userIds.map(async (userId) => this.sessionCache.invalidateUser(userId)),
    );

    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        this.logger.warn(
          { err: outcome.reason as unknown, userId: userIds[index] },
          'Session-cache user-generation bump failed after a staff session revoke',
        );
      }
    });
  }

  /**
   * Only the settings fields the body actually carried. An allowlist over the rule order, so
   * `confirmDisableStaffMfa` (and anything else on the DTO) can never reach the row.
   */
  private static changesIn(dto: UpdateAuthSettingsDto): Partial<ResolvedAuthSettings> {
    return Object.fromEntries(
      AUTH_SETTINGS_FIELD_ORDER.filter((field) => dto[field] !== undefined).map((field) => [
        field,
        dto[field],
      ]),
    );
  }

  /** The 400 the merged candidate earns, or `null` when it may be written. */
  private static refusalFor(
    effective: ResolvedAuthSettings,
    merged: ResolvedAuthSettings,
    dto: UpdateAuthSettingsDto,
  ): ServiceResponse<never> | null {
    const violations = checkAuthSettings(merged);
    if (violations.length > 0) {
      return serviceFail(
        HttpStatus.BAD_REQUEST,
        violations.map((violation) => violation.message).join(' '),
      );
    }

    if (
      AuthSettingsAdminService.disablesStaffMfa(effective, merged) &&
      dto.confirmDisableStaffMfa !== true
    ) {
      return serviceFail(HttpStatus.BAD_REQUEST, AuthMessages.StaffMfaDisableNeedsConfirmation);
    }

    return null;
  }

  /** The audit action: each staff MFA transition has its own, anything else is an update. */
  private static actionFor(
    effective: ResolvedAuthSettings,
    merged: ResolvedAuthSettings,
  ): AdminAuditAction {
    if (AuthSettingsAdminService.disablesStaffMfa(effective, merged)) {
      return AdminAuditActions.AuthStaffMfaDisabled;
    }

    if (AuthSettingsAdminService.enablesStaffMfa(effective, merged)) {
      return AdminAuditActions.AuthStaffMfaEnabled;
    }

    return AdminAuditActions.AuthSettingsUpdated;
  }

  /**
   * True only for the false → true transition. true → true, false → false and a PATCH without
   * `staffMfaRequired` (which merges the effective value back) are not transitions.
   */
  private static enablesStaffMfa(
    effective: ResolvedAuthSettings,
    merged: ResolvedAuthSettings,
  ): boolean {
    return !effective.staffMfaRequired && merged.staffMfaRequired;
  }

  /** True only for the true → false transition; an already-off setting needs no confirmation. */
  private static disablesStaffMfa(
    effective: ResolvedAuthSettings,
    merged: ResolvedAuthSettings,
  ): boolean {
    return effective.staffMfaRequired && !merged.staffMfaRequired;
  }

  /**
   * `before` and `after` are the settings objects themselves: lifetimes and one flag, no
   * credentials. They are copied into plain objects for the JSON column.
   *
   * When the read had fallen back for some stored fields, `after` also carries
   * `healedFallbacks` and `before` carries `healedFrom`, the raw stored values the write
   * overwrote. Writing the effective values replaces those invalid stored values, so without
   * them a write that repaired the row would look the same as any other, and the bad values
   * would be gone from every record.
   *
   * `revokedStaffSessions` is `null` unless the write revoked staff sessions; when it did, the
   * count is recorded in `after`.
   */
  private static auditRow(
    actor: Actor,
    action: AdminAuditAction,
    entityId: string,
    current: AuthSettingsWithFallbacks,
    merged: ResolvedAuthSettings,
    revokedStaffSessions: number | null,
  ): AuditLogWriteData {
    const healedAny = current.fallbacks.length > 0;
    const healed = healedAny ? { healedFallbacks: [...current.fallbacks] } : {};
    const healedFrom = healedAny ? { healedFrom: { ...current.storedFallbackValues } } : {};
    const revoked = revokedStaffSessions === null ? {} : { revokedStaffSessions };

    return {
      actorId: actor.id,
      actorEmail: actor.user.email ?? null,
      actorRole: actor.user.role,
      action,
      entityType: AdminAuditEntities.AuthSettings,
      entityId,
      before: { ...current.settings, ...healedFrom },
      after: { ...merged, ...healed, ...revoked },
      requestId: null,
    };
  }
}

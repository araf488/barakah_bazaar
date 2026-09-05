import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Prisma, UserRole } from '../../infra/prisma/prisma-client';
import { AdminAuditActions, AdminAuditEntities } from '../admin/admin.constants';
import { AuditLogRepository, AuditLogWriteData } from '../admin/audit-log.repository';
import { truncateIp } from './ip-truncation';

/**
 * Who an event is about. Structural rather than the Prisma `User` row, so a caller that only
 * holds a verified token (`AuthenticatedUser`) or a cached session can record one without a
 * database read it does not otherwise need.
 */
export interface AuthEventActor {
  readonly id: string;
  readonly email: string | null;
  readonly role: UserRole;
}

/**
 * Where an authentication event happened. Deliberately narrow: there is no field for a token,
 * a password, a TOTP code or a recovery code, so a caller cannot hand one to the audit trail
 * by mistake.
 */
export interface AuthEventContext {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

/** Why a session ended, when it was not the user signing themselves out. */
export type SessionRevocationReason = 'device_mismatch' | 'owner_revoked' | 'all_sessions_ended';

/**
 * Writes authentication events to the admin audit trail.
 *
 * **Staff only, by design.** Recording every customer login would bury the staff signal in
 * orders of magnitude more noise and turn an operational log into shopper surveillance. The
 * question this trail answers is "which privileged account did what, from where" — so it
 * records the accounts that hold privilege.
 *
 * Every method is fire-and-forget with respect to the caller's result: an audit failure is
 * logged but never turns a successful sign-in into an error. That asymmetry is deliberate —
 * for a business write the audit row is part of the transaction and its failure rolls the
 * write back, but refusing to sign a staff member in because a log table is unreachable
 * trades a recording gap for an outage.
 */
@Injectable()
export class AuthEventsService {
  constructor(
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(AuthEventsService.name) private readonly logger: PinoLogger,
  ) {}

  /** The actor a route already verified, without going back to the database for the row. */
  static actorFrom(user: AuthenticatedUser): AuthEventActor {
    return { id: user.userId, email: user.email, role: user.role };
  }

  /** A completed sign-in. Written once a session exists, not when a password merely verified. */
  async recordLogin(user: AuthEventActor, context: AuthEventContext): Promise<void> {
    await this.record(user, AdminAuditActions.AuthLogin, context.sessionId, context);
  }

  /**
   * A sign-in from a device this account has no earlier session for. Written alongside
   * `recordLogin`, not instead of it: "signed in" and "signed in somewhere new" are different
   * questions, and an alert on the second must not have to reconstruct it from the first.
   */
  async recordNewDevice(user: AuthEventActor, context: AuthEventContext): Promise<void> {
    await this.record(user, AdminAuditActions.AuthNewDevice, context.sessionId, context);
  }

  /**
   * A rejected password, for an account that exists. An unknown address writes nothing — the
   * row would record an attacker-supplied string against no actor, and a log filled with those
   * is how the real signal gets lost.
   */
  async recordLoginFailed(user: AuthEventActor, context: AuthEventContext): Promise<void> {
    await this.record(user, AdminAuditActions.AuthLoginFailed, context.sessionId, context);
  }

  /** A rejected second factor: the password was right and the code was not. */
  async recordMfaFailed(user: AuthEventActor, context: AuthEventContext): Promise<void> {
    await this.record(user, AdminAuditActions.AuthMfaFailed, context.sessionId, context);
  }

  /** The user ending their own current session. */
  async recordLogout(user: AuthEventActor, sessionId: string): Promise<void> {
    await this.record(user, AdminAuditActions.AuthLogout, sessionId, null);
  }

  /**
   * A session ended by anything other than its own holder signing out — another of the user's
   * devices, a full sign-out everywhere, or the guard revoking on a device mismatch. The
   * reason is recorded because "when did this session end, and why" is the first question an
   * incident review asks.
   */
  async recordSessionRevoked(
    user: AuthEventActor,
    sessionId: string,
    reason: SessionRevocationReason,
  ): Promise<void> {
    await this.record(user, AdminAuditActions.AuthSessionRevoked, sessionId, null, { reason });
  }

  /**
   * A deliberate password change. Not written for the silent rehash that follows a successful
   * login at new scrypt parameters — the credential did not change, only its encoding, and
   * recording that as a password change would make the trail lie.
   *
   * No endpoint calls this yet: the change-password route is a later sub-project. It is
   * declared here with the rest of the vocabulary so that route does not have to invent its
   * own action string, which is exactly how a closed action set drifts open.
   */
  async recordPasswordChanged(user: AuthEventActor): Promise<void> {
    await this.record(user, AdminAuditActions.AuthPasswordChanged, user.id, null);
  }

  /**
   * The one path to the repository. `details` is built here field by field from the narrow
   * context type — the context object is never spread into the row, so an extra property on a
   * caller's object cannot reach the database.
   */
  private async record(
    user: AuthEventActor,
    action: string,
    entityId: string,
    context: AuthEventContext | null,
    extra?: Prisma.InputJsonObject,
  ): Promise<void> {
    if (user.role === UserRole.CUSTOMER) {
      return;
    }

    try {
      const written = await this.auditLog.append(
        AuthEventsService.row(user, action, entityId, context, extra),
      );

      if (!written) {
        this.logger.warn({ action, userId: user.id }, 'Auth event could not be recorded');
      }
    } catch (error) {
      this.logger.error(
        { err: error, action, userId: user.id },
        'Exception occurred in AuthEventsService.record',
      );
    }
  }

  private static row(
    user: AuthEventActor,
    action: string,
    entityId: string,
    context: AuthEventContext | null,
    extra?: Prisma.InputJsonObject,
  ): AuditLogWriteData {
    const after = { ...AuthEventsService.details(context), ...(extra ?? {}) };

    return {
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action,
      entityType: AdminAuditEntities.Session,
      entityId,
      before: undefined,
      after: Object.keys(after).length > 0 ? after : undefined,
      requestId: null,
    };
  }

  /** Named fields only. The IP is truncated with the same function the session listing uses. */
  private static details(context: AuthEventContext | null): Prisma.InputJsonObject {
    if (context === null) {
      return {};
    }

    return {
      sessionId: context.sessionId,
      deviceId: context.deviceId,
      userAgent: context.userAgent,
      ipAddress: truncateIp(context.ip),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaErrorCodes } from '../../common/constants/app.constants';
import { AuthSettings, Prisma, UserRole } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthConstants } from '../auth/auth.constants';
import { ResolvedAuthSettings } from '../auth/settings/auth-settings.rules';
import { AuditLogRepository, AuditLogWriteData } from './audit-log.repository';

/**
 * A guarded settings write. Either it was written, or the row changed after the caller read it
 * (`conflict`). `null` means the database faulted and nothing was applied.
 */
export type AuthSettingsWriteResult =
  | {
      readonly kind: 'written';
      readonly row: AuthSettings;
      /** How many staff sessions the same transaction revoked; 0 when none was asked for. */
      readonly revokedStaffSessions: number;
      /**
       * The owners of those sessions, so the caller can bump each one's session-cache generation
       * once the transaction has committed. Empty when no revoke was asked for.
       */
      readonly revokedStaffUserIds: readonly string[];
    }
  | { readonly kind: 'conflict' }
  | null;

/** What else the settings write must do inside its transaction. */
export interface AuthSettingsWriteOptions {
  /**
   * Revoke every live session of every non-`CUSTOMER` account in the same transaction, so a
   * fault or a lost race leaves the sessions untouched along with the settings.
   */
  readonly revokeStaffSessions?: boolean;
}

/** Called with the written row and how many staff sessions the same transaction revoked. */
export type AuthSettingsAuditBuilder = (
  row: AuthSettings,
  revokedStaffSessions: number,
) => AuditLogWriteData;

/** What a staff-session revoke did: how many sessions, and which accounts owned them. */
interface StaffSessionRevoke {
  readonly count: number;
  readonly userIds: readonly string[];
}

/** The result when no revoke was asked for. */
const NO_REVOKE: StaffSessionRevoke = { count: 0, userIds: [] };

/** Every live session of a staff (non-`CUSTOMER`) account. */
const LIVE_STAFF_SESSIONS: Prisma.SessionWhereInput = {
  revokedAt: null,
  user: { role: { not: UserRole.CUSTOMER } },
};

/**
 * The write side of the singleton `auth_settings` row.
 *
 * Reads stay with `AuthSettingsRepository` in the auth module, which owns the cache and the
 * per-field fallbacks. This class exists so the admin write and its audit row can share one
 * transaction with `AuditLogRepository.appendWithin`.
 */
@Injectable()
export class AuthSettingsAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(AuthSettingsAdminRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Writes the whole settings row and its audit entry in ONE transaction, but only if the row
   * is still the one the caller read. This is optimistic concurrency on `updatedAt`.
   *
   * The caller merged its change over a snapshot and writes the WHOLE row back. Without the
   * guard, two concurrent PATCHes are a lost update. For example, one enables staff MFA, and
   * another, read before that commit, changes an unrelated field but carries the stale
   * `staffMfaRequired: false` back with it. That silently re-disables staff MFA, with no
   * confirmation and no `auth.staff_mfa_disabled` audit action.
   *
   * - `expectedUpdatedAt` is a date: the update matches only while the row still carries it.
   *   No match is a conflict.
   * - `expectedUpdatedAt` is `null` (no row was read): the row is created. A unique violation
   *   means someone else created it first, which is the same conflict.
   *
   * With `options.revokeStaffSessions`, the staff sessions are revoked after the guard matched
   * and before the audit row, all in the one transaction: the settings, the revoke and the
   * audit row (which records the count) commit together or not at all.
   */
  async writeAudited(
    data: ResolvedAuthSettings,
    expectedUpdatedAt: Date | null,
    audit: AuthSettingsAuditBuilder,
    options: AuthSettingsWriteOptions = {},
  ): Promise<AuthSettingsWriteResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await AuthSettingsAdminRepository.applyGuarded(tx, data, expectedUpdatedAt);

        const revoked = options.revokeStaffSessions
          ? await AuthSettingsAdminRepository.revokeStaffSessions(tx)
          : NO_REVOKE;

        const row = await tx.authSettings.findUniqueOrThrow({
          where: { id: AuthConstants.AuthSettingsRowId },
        });
        await this.auditLog.appendWithin(tx, audit(row, revoked.count));
        return {
          kind: 'written',
          row,
          revokedStaffSessions: revoked.count,
          revokedStaffUserIds: revoked.userIds,
        } as const;
      });
    } catch (error) {
      if (AuthSettingsAdminRepository.isConflict(error)) {
        // Expected outcome of a race, not a fault. Logged at info so a spike stays visible.
        this.logger.info('Auth settings changed concurrently; write not applied');
        return { kind: 'conflict' };
      }

      this.logger.error(
        { err: error },
        'Exception occurred in AuthSettingsAdminRepository.writeAudited',
      );
      return null;
    }
  }

  /** Throws `SettingsChangedConcurrentlyError` (rolling the transaction back) when the guard fails. */
  private static async applyGuarded(
    tx: Prisma.TransactionClient,
    data: ResolvedAuthSettings,
    expectedUpdatedAt: Date | null,
  ): Promise<void> {
    if (expectedUpdatedAt === null) {
      await tx.authSettings.create({ data: { id: AuthConstants.AuthSettingsRowId, ...data } });
      return;
    }

    const affected = await tx.authSettings.updateMany({
      where: { id: AuthConstants.AuthSettingsRowId, updatedAt: expectedUpdatedAt },
      data,
    });

    if (affected.count === 0) {
      throw new SettingsChangedConcurrentlyError();
    }
  }

  /**
   * Ends every live session that belongs to a staff (non-`CUSTOMER`) account, and reports how
   * many and whose. The owners are selected first, in the same transaction, so the caller can
   * bump their session-cache generations after the commit; the revoke itself keeps the role
   * predicate rather than `userId in (…)`, so a staff session opened between the two statements
   * is still revoked (it can only miss a cache bump, and a session that new is not cached yet). The same write `SessionRepository.revokeAllForUser` makes — stamp `revokedAt` once,
   * with `revokedAt: null` in the predicate so an earlier revocation time survives; there is no
   * revoke-reason column. It is inlined rather than reused because the repository method runs
   * on its own client, not inside this transaction.
   *
   * All staff, not only those who signed in without a second factor: `sessions` does not record
   * whether MFA was used at sign-in.
   */
  private static async revokeStaffSessions(
    tx: Prisma.TransactionClient,
  ): Promise<StaffSessionRevoke> {
    const owners = await tx.session.findMany({
      where: LIVE_STAFF_SESSIONS,
      select: { userId: true },
      distinct: ['userId'],
    });
    const result = await tx.session.updateMany({
      where: LIVE_STAFF_SESSIONS,
      data: { revokedAt: new Date() },
    });
    return { count: result.count, userIds: owners.map((owner) => owner.userId) };
  }

  /** A lost guard, or a create that lost the race to another create. */
  private static isConflict(error: unknown): boolean {
    return (
      error instanceof SettingsChangedConcurrentlyError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCodes.UniqueConstraint)
    );
  }
}

/** Thrown inside the transaction to roll it back when the guard failed. Never leaves this file. */
class SettingsChangedConcurrentlyError extends Error {}

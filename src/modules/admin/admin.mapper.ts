import { AdminAuditLog, User } from '../../infra/prisma/prisma-client';
import { AdminUserDto } from './dto/admin-user.dto';
import { AuditLogEntryDto } from './dto/audit-log.dto';

/**
 * Audit rows to the wire contract.
 *
 * Written out longhand rather than spread, so a column added to the table is never published
 * to the admin portal by accident.
 */
export const AdminMapper = {
  toAuditEntry(entry: AdminAuditLog): AuditLogEntryDto {
    return {
      id: entry.id,
      actorId: entry.actorId,
      actorEmail: entry.actorEmail,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      requestId: entry.requestId,
      createdAt: entry.createdAt,
    };
  },

  toAuditEntries(entries: readonly AdminAuditLog[]): AuditLogEntryDto[] {
    return entries.map((entry) => AdminMapper.toAuditEntry(entry));
  },

  /**
   * A user as staff see them. Wider than `UserProfileDto` — it carries `isActive` and
   * `lastSeenAt`, which a customer never sees about themselves — but still written out
   * longhand so a new column is never published by accident.
   */
  toAdminUser(user: User): AdminUserDto {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      lastSeenAt: user.lastSeenAt,
      createdAt: user.createdAt,
    };
  },

  toAdminUsers(users: readonly User[]): AdminUserDto[] {
    return users.map((user) => AdminMapper.toAdminUser(user));
  },
} as const;

import { StaffInvitation } from '../../infra/prisma/prisma-client';
import { AuditLogWriteData } from './audit-log.repository';

/**
 * Serialises for the trail with the token hash stripped and BigInts widened.
 *
 * The explicit replacer rather than the global hook `main.ts` installs, so this behaves
 * identically outside the bootstrap — the same reasoning as AuditLogService.toJson.
 */
export const invitationAuditJson = (row: StaffInvitation | null): AuditLogWriteData['before'] => {
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
};

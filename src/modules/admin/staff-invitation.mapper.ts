import { StaffInvitation } from '../../infra/prisma/prisma-client';
import { StaffInvitationDto } from './dto/staff-invitation.dto';

/**
 * Wire format for an invitation.
 *
 * `tokenHash` is never mapped. It is the stored half of a live credential, and returning it
 * would let a compromised staff account read back a pending grant.
 */
export const StaffInvitationMapper = {
  toDto(row: StaffInvitation, now: Date = new Date()): StaffInvitationDto {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      // Derived, never stored: a row cannot claim to be open while its deadline has passed.
      isExpired: row.expiresAt.getTime() <= now.getTime(),
      expiresAt: row.expiresAt.toISOString(),
      invitedBy: row.invitedBy,
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  },
} as const;

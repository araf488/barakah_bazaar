import { createHash } from 'node:crypto';

/**
 * How an invitation token is stored: hex SHA-256. Hex, not base64url like the auth module's
 * credentials, because rows already in `staff_invitations` were written this way — changing
 * the encoding would silently invalidate every open invitation.
 */
export const hashInvitationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

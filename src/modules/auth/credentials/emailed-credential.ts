import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AuthConstants } from '../auth.constants';

/**
 * Pure helpers for a credential this API emails: a link token and a short code, stored only as
 * hashes. Shared by email verification and password reset.
 *
 * Only the logic that is *identical* lives here. The two service flows deliberately do not
 * share code: completing a reset revokes sessions and writes a password, and folding that
 * behind one name with verification would make every future edit ask "which flow am I in".
 */

/** The two fields `isLive` reads. Both credential tables have them. */
export interface ExpiringCredentialRecord {
  readonly consumedAt: Date | null;
  readonly expiresAt: Date;
}

/** base64url SHA-256, matching `SessionService.hashToken`. The raw value is never persisted. */
export const hashCredential = (raw: string): string =>
  createHash('sha256').update(raw).digest('base64url');

/**
 * Compares the presented code's hash to the stored one in constant time. The length check comes
 * first because `timingSafeEqual` throws on unequal lengths. Both sides are fixed-length digests,
 * so it never fires in practice; it is the same defensive pattern used everywhere else this
 * codebase compares a hash.
 */
export const codeMatches = (code: string, codeHash: string): boolean => {
  const provided = Buffer.from(hashCredential(code));
  const expected = Buffer.from(codeHash);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

/** A zero-padded, fixed-width code. `randomInt`, never `Math.random` — this is a credential. */
export const generateCode = (digits: number): string =>
  randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');

/** A record that exists, has not been consumed, and has not expired. */
export const isLive = <T extends ExpiringCredentialRecord>(record: T | undefined): record is T =>
  record !== undefined && record.consumedAt === null && record.expiresAt.getTime() > Date.now();

/**
 * Whether `createdAt` is no older than `cooldownSeconds`. The window is a parameter, not a
 * constant, because verification resends and reset requests may not share a value.
 */
export const withinCooldown = (createdAt: Date, cooldownSeconds: number): boolean =>
  Date.now() - createdAt.getTime() <= cooldownSeconds * AuthConstants.MillisecondsPerSecond;

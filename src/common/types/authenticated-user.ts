import { UserRole } from '../../infra/prisma/prisma-client';

/**
 * The caller, as proven by a session this API issued. Attached by SessionAuthGuard and
 * injected with `@CurrentUser()`.
 *
 * Unlike the Supabase-era version, this is not "the token's view" of the user: the guard
 * has already read the `users` row, so `role` here is the stored role and `isActive` has
 * already been enforced.
 */
export interface AuthenticatedUser {
  /** Local `users.id`. */
  readonly userId: string;
  /** Which session — what makes logout and revocation immediate. */
  readonly sessionId: string;
  readonly email: string;
  readonly phone?: string;
  readonly role: UserRole;
}

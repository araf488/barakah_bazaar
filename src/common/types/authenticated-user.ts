import { UserRole } from '../../infra/prisma/prisma-client';

/**
 * The caller, as proven by a verified Supabase access token. Attached to the
 * request by SupabaseAuthGuard and injected with `@CurrentUser()`.
 *
 * This is the *token's* view of the user. The local `users` row (and therefore
 * `isActive`) is resolved separately by AuthService.
 */
export interface AuthenticatedUser {
  /** Supabase Auth `sub` claim. Foreign key into `users.supabase_user_id`. */
  readonly supabaseUserId: string;
  readonly email?: string;
  readonly phone?: string;
  /** From `app_metadata.role`; defaults to CUSTOMER when the claim is absent. */
  readonly role: UserRole;
  /** Unix seconds. Useful for shorter admin session enforcement later. */
  readonly issuedAt?: number;
  readonly expiresAt?: number;
}

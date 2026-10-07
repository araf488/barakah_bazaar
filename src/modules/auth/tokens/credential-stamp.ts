import { User } from '../../../infra/prisma/prisma-client';

/**
 * The credential stamp an intermediate token carries in its `pca` claim: the account's
 * `passwordChangedAt` as epoch milliseconds, or `0` for an account whose password has never
 * changed.
 *
 * One function for both sides — `LoginService` signs it, `MfaService` compares against it — so
 * the encoding cannot drift between the two and turn every token stale (or none of them).
 */
export const credentialStampOf = (user: Pick<User, 'passwordChangedAt'>): number =>
  user.passwordChangedAt?.getTime() ?? 0;

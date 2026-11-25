import { User, UserRole } from '../../../infra/prisma/prisma-client';

/**
 * Everything `SessionService.validate` needs to decide whether a session may act, and to build
 * the `AuthenticatedUser` the guard attaches to the request, without a database read.
 *
 * Deliberately excludes `refreshTokenHash` and `previousRefreshTokenHash`: a refresh token
 * hash is a stored credential, and a cache that exists to serve read-only validation has no
 * business holding one. Also excludes `lastUsedAt`: the sliding idle-deadline write
 * (`SessionService.slideIdleDeadline`) needs it, and a cache hit deliberately skips that write
 * rather than fabricate it — see the comment on `SessionService.tryFromCache`.
 */
export interface CachedSessionValue {
  readonly userId: string;
  readonly role: UserRole;
  /** `User.email`. Every account has one — it is the login credential. */
  readonly email: string;
  /** `User.phone`, nullable for email-only accounts. Read by `SessionAuthGuard`. */
  readonly phone: string | null;
  readonly isActive: boolean;
  readonly deviceId: string;
  /**
   * The user agent the session was issued to, compared on every request so a change can be
   * logged as an anomaly (§5.6). Cached rather than read from the row because the cache
   * serves the overwhelming majority of validations — comparing only on a miss would make
   * the signal fire almost nowhere, which is indistinguishable from not building it.
   */
  readonly userAgent: string | null;
  /** ISO-8601. The sliding idle deadline as of the moment this value was cached. */
  readonly expiresAt: string;
  /** ISO-8601. The hard ceiling; a value is never cached past this instant. */
  readonly absoluteExpiresAt: string;
  /** ISO-8601, or `null` while the session is live. */
  readonly revokedAt: string | null;
}

/** Builds a `CachedSessionValue` from the row `SessionRepository.findByIdWithUser` returns. */
export const toCachedSessionValue = (
  user: User,
  session: {
    deviceId: string;
    userAgent: string | null;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    revokedAt: Date | null;
  },
): CachedSessionValue => ({
  userId: user.id,
  role: user.role,
  email: user.email,
  phone: user.phone,
  isActive: user.isActive,
  deviceId: session.deviceId,
  userAgent: session.userAgent,
  expiresAt: session.expiresAt.toISOString(),
  absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  revokedAt: session.revokedAt?.toISOString() ?? null,
});

/**
 * Read-through cache for `SessionRepository.findByIdWithUser`, the one database query
 * `SessionService.validate` runs on every authenticated request.
 *
 * Every implementation must fail open to a cache MISS, never to a hit: a Redis timeout, a
 * connection error, or a payload that does not parse as a `CachedSessionValue` all resolve to
 * `null` from `read`, which sends the caller back to the database. Nothing an implementation
 * does may manufacture a valid-looking session, and no cache fault may escape as a thrown
 * error into `SessionService`.
 *
 * `invalidateUser` bumps a per-user generation counter rather than scanning or deleting
 * individual keys — `KEYS`/`SCAN` on the authentication hot path is not acceptable, and a
 * generation counter makes every session cached before the bump unreadable on its next lookup
 * without enumerating them.
 */
export interface SessionCachePort {
  /**
   * `userId` is the access token's already-verified `sub` claim, not untrusted input — it
   * names which per-user generation counter this read must agree with, so a value cached
   * before a `revokeAll`, a role change, or a password change is a miss rather than a hit.
   */
  read(sessionId: string, userId: string): Promise<CachedSessionValue | null>;
  /** `ttlSeconds <= 0` writes nothing — the caller has already decided the value has no useful life left. */
  write(sessionId: string, value: CachedSessionValue, ttlSeconds: number): Promise<void>;
  invalidateSession(sessionId: string): Promise<void>;
  invalidateUser(userId: string): Promise<void>;
}

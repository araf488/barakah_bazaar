import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CachedSessionValue, SessionCachePort } from './session-cache.port';

/**
 * The subset of ioredis's client this adapter calls, kept narrow so a unit test can hand it a
 * plain mock instead of a real connection.
 */
export interface SessionCacheRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  incr(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

/** What is actually stored under a session key: the port's value plus the generation it was cached under. */
interface StoredSessionValue extends CachedSessionValue {
  readonly generation: number;
}

const SESSION_KEY_PREFIX = 'session-cache:session:';
const USER_GENERATION_KEY_PREFIX = 'session-cache:user-gen:';

const sessionKey = (sessionId: string): string => `${SESSION_KEY_PREFIX}${sessionId}`;
const userGenerationKey = (userId: string): string => `${USER_GENERATION_KEY_PREFIX}${userId}`;

/**
 * Narrows an arbitrary parsed JSON value to a `StoredSessionValue`.
 *
 * A malformed payload — a truncated write, a value written by an incompatible previous
 * version of this cache, or (in principle) a Redis instance shared with something else — must
 * never be trusted blindly for an authentication decision. `read` treats a failure here exactly
 * like a parse error: a miss, not a throw.
 */
const isStoredSessionValue = (value: unknown): value is StoredSessionValue => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.role === 'string' &&
    (typeof candidate.email === 'string' || candidate.email === null) &&
    (typeof candidate.phone === 'string' || candidate.phone === null) &&
    typeof candidate.isActive === 'boolean' &&
    typeof candidate.deviceId === 'string' &&
    // Required, not tolerated as absent: an entry written before this field existed is
    // rejected here and re-read from the database, which then caches it complete. Defaulting
    // a missing one to `null` instead would make every such entry report a user-agent anomaly
    // it has no evidence for — a false security signal, repeated until the entry expires,
    // which is worse than one "discarding malformed payload" line per stale session.
    (typeof candidate.userAgent === 'string' || candidate.userAgent === null) &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.absoluteExpiresAt === 'string' &&
    (typeof candidate.revokedAt === 'string' || candidate.revokedAt === null) &&
    typeof candidate.generation === 'number'
  );
};

/**
 * Redis-backed `SessionCachePort`, selected only when `SESSION_CACHE_ENABLED=true`
 * (`session-cache.factory.ts`).
 *
 * Every method fails open: a Redis error, a timeout, or a payload that does not parse as a
 * `StoredSessionValue` is logged at `warn` and answered as a miss (`read`) or otherwise
 * swallowed (`write`/`invalidateSession`/`invalidateUser`) — never as a valid session, and
 * never by throwing into `SessionService`, which would turn an unavailable cache into a 500 on
 * a request the database could still have served. `warn`, not `error`, because an unavailable
 * cache is an expected condition on this path, not a fault.
 *
 * The generation check is what makes `revokeAll` and a role/password change effective without
 * enumerating keys: `read` fetches the session entry and the caller's current generation with
 * one `MGET`, and a value cached under an older generation is discarded as a miss.
 */
@Injectable()
export class RedisSessionCache implements SessionCachePort {
  constructor(
    private readonly client: SessionCacheRedisClient,
    private readonly logger: PinoLogger,
  ) {}

  async read(sessionId: string, userId: string): Promise<CachedSessionValue | null> {
    try {
      const [rawSession, rawGeneration] = await this.client.mget(
        sessionKey(sessionId),
        userGenerationKey(userId),
      );

      return RedisSessionCache.decode(rawSession, rawGeneration, userId, sessionId, this.logger);
    } catch (error) {
      this.logger.warn(
        { err: error, sessionId },
        'Session-cache read failed; falling back to the database',
      );
      return null;
    }
  }

  async write(sessionId: string, value: CachedSessionValue, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      return;
    }

    try {
      const rawGeneration = await this.client.get(userGenerationKey(value.userId));
      const generation = rawGeneration === null ? 0 : Number(rawGeneration);
      const stored: StoredSessionValue = { ...value, generation };
      await this.client.set(sessionKey(sessionId), JSON.stringify(stored), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        { err: error, sessionId },
        'Session-cache write failed; continuing without caching',
      );
    }
  }

  async invalidateSession(sessionId: string): Promise<void> {
    try {
      await this.client.del(sessionKey(sessionId));
    } catch (error) {
      this.logger.warn({ err: error, sessionId }, 'Session-cache invalidation failed');
    }
  }

  async invalidateUser(userId: string): Promise<void> {
    try {
      await this.client.incr(userGenerationKey(userId));
    } catch (error) {
      this.logger.warn({ err: error, userId }, 'Session-cache user-generation bump failed');
    }
  }

  /**
   * Turns the raw `MGET` pair into a value the caller may trust, or `null`.
   *
   * A static helper, not inline in `read`, purely to keep `read`'s own cognitive complexity
   * low — this is where every rejection branch (absent, malformed, wrong owner, stale
   * generation) lives.
   */
  private static decode(
    rawSession: string | null,
    rawGeneration: string | null,
    userId: string,
    sessionId: string,
    logger: PinoLogger,
  ): CachedSessionValue | null {
    if (rawSession === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(rawSession);

    if (!isStoredSessionValue(parsed)) {
      logger.warn({ sessionId }, 'Discarding malformed session-cache payload');
      return null;
    }

    const currentGeneration = rawGeneration === null ? 0 : Number(rawGeneration);

    if (parsed.userId !== userId || parsed.generation !== currentGeneration) {
      return null;
    }

    // Built out field by field, rather than destructuring `generation` away, so the returned
    // shape is visibly exactly `CachedSessionValue` and adding a field to `StoredSessionValue`
    // later cannot leak through unnoticed.
    return {
      userId: parsed.userId,
      role: parsed.role,
      email: parsed.email,
      phone: parsed.phone,
      isActive: parsed.isActive,
      deviceId: parsed.deviceId,
      userAgent: parsed.userAgent,
      expiresAt: parsed.expiresAt,
      absoluteExpiresAt: parsed.absoluteExpiresAt,
      revokedAt: parsed.revokedAt,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { CachedSessionValue, SessionCachePort } from './session-cache.port';

/**
 * Default session cache: always a miss, every write and invalidation a no-op.
 *
 * Active while `SESSION_CACHE_ENABLED=false` (the default), so local development and CI need
 * no Redis, and `SessionService.validate` runs exactly the database read it always ran.
 *
 * Deliberately silent: this runs on every authenticated request when active, and logging a
 * line per request for a permanent, expected no-op would flood the log for no reason — unlike
 * `RedisSessionCache`, where a `warn` marks an actual fault.
 */
@Injectable()
export class NoopSessionCache implements SessionCachePort {
  read(_sessionId: string, _userId: string): Promise<CachedSessionValue | null> {
    return Promise.resolve(null);
  }

  write(_sessionId: string, _value: CachedSessionValue, _ttlSeconds: number): Promise<void> {
    return Promise.resolve();
  }

  invalidateSession(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }

  invalidateUser(_userId: string): Promise<void> {
    return Promise.resolve();
  }
}

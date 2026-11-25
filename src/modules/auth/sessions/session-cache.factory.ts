import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { NoopSessionCache } from './noop-session-cache';
import { RedisSessionCache } from './redis-session-cache';
import { SessionCachePort } from './session-cache.port';

/**
 * Chooses the session-cache adapter from `SESSION_CACHE_ENABLED`, following the same
 * off-by-default shape as `QueueModule.forRoot()`: local development and CI need no Redis.
 *
 * Reuses the existing `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS` connection
 * settings rather than adding a second set — this and BullMQ may point at the same Redis, or
 * at none at all, independently of each other.
 */
export const createSessionCache = (
  config: AppConfigService,
  logger: PinoLogger,
): SessionCachePort => {
  const enabled = config.get('SESSION_CACHE_ENABLED', { infer: true });

  if (!enabled) {
    return new NoopSessionCache();
  }

  const client = new Redis({
    host: config.get('REDIS_HOST', { infer: true }),
    port: config.get('REDIS_PORT', { infer: true }),
    password: config.get('REDIS_PASSWORD', { infer: true }),
    ...(config.get('REDIS_TLS', { infer: true }) ? { tls: {} } : {}),
  });

  // ioredis emits 'error' for every failed connection attempt; with no listener at all, Node
  // treats that as an unhandled error and crashes the process — the opposite of "an
  // unavailable cache degrades to the slow path". This listener is what makes the fail-open
  // behaviour in RedisSessionCache's own try/catch blocks reachable at all.
  client.on('error', (error: Error) => {
    logger.warn({ err: error }, 'Redis session-cache connection error');
  });

  return new RedisSessionCache(client, logger);
};

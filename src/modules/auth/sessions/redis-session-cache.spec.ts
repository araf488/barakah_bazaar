import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { UserRole } from '../../../infra/prisma/prisma-client';
import { CachedSessionValue } from './session-cache.port';
import { RedisSessionCache, SessionCacheRedisClient } from './redis-session-cache';

const value: CachedSessionValue = {
  userId: 'user-1',
  role: UserRole.CUSTOMER,
  email: 'shopper@example.com',
  phone: null,
  isActive: true,
  deviceId: 'device-1',
  expiresAt: new Date('2026-09-02T13:00:00.000Z').toISOString(),
  absoluteExpiresAt: new Date('2026-10-02T13:00:00.000Z').toISOString(),
  revokedAt: null,
};

/** A stateful fake, used only for the round-trip test where the generation must actually move. */
class InMemoryRedisClient implements SessionCacheRedisClient {
  private readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.resolve(keys.map((key) => this.store.get(key) ?? null));
  }

  incr(key: string): Promise<number> {
    const next = (Number(this.store.get(key) ?? '0') || 0) + 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }
}

describe('RedisSessionCache', () => {
  let client: jest.Mocked<SessionCacheRedisClient>;
  let logger: jest.Mocked<PinoLogger>;
  let cache: RedisSessionCache;

  beforeEach(() => {
    client = {
      get: jest.fn(),
      set: jest.fn(),
      mget: jest.fn(),
      incr: jest.fn(),
      del: jest.fn(),
    };
    logger = createMockLogger();
    cache = new RedisSessionCache(client, logger);
  });

  describe('read', () => {
    it('is a miss when nothing is stored under the session key', async () => {
      client.mget.mockResolvedValue([null, null]);

      await expect(cache.read('session-1', 'user-1')).resolves.toBeNull();
    });

    it('is a hit when the stored generation matches the current one', async () => {
      client.mget.mockResolvedValue([JSON.stringify({ ...value, generation: 3 }), '3']);

      await expect(cache.read('session-1', 'user-1')).resolves.toEqual(value);
    });

    it('treats an absent generation key as generation 0', async () => {
      client.mget.mockResolvedValue([JSON.stringify({ ...value, generation: 0 }), null]);

      await expect(cache.read('session-1', 'user-1')).resolves.toEqual(value);
    });

    it('is a miss when the stored generation is older than the current one — the revokeAll case', async () => {
      client.mget.mockResolvedValue([JSON.stringify({ ...value, generation: 1 }), '2']);

      await expect(cache.read('session-1', 'user-1')).resolves.toBeNull();
    });

    it('fetches the session and the generation with a single MGET call', async () => {
      client.mget.mockResolvedValue([null, null]);

      await cache.read('session-1', 'user-1');

      expect(client.mget).toHaveBeenCalledTimes(1);
      expect(client.mget).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    });

    it('is a miss when the stored userId disagrees with the key it was filed under', async () => {
      client.mget.mockResolvedValue([
        JSON.stringify({ ...value, userId: 'user-2', generation: 0 }),
        null,
      ]);

      await expect(cache.read('session-1', 'user-1')).resolves.toBeNull();
    });

    it('discards a payload that is not valid JSON, and logs a warning rather than throwing', async () => {
      client.mget.mockResolvedValue(['{not json', null]);

      await expect(cache.read('session-1', 'user-1')).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('discards a payload missing required fields, and logs a warning', async () => {
      client.mget.mockResolvedValue([JSON.stringify({ userId: 'user-1' }), null]);

      await expect(cache.read('session-1', 'user-1')).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('falls back to a miss, not a throw, when the client errors', async () => {
      client.mget.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(cache.read('session-1', 'user-1')).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('never returns a refreshTokenHash or previousRefreshTokenHash even if one was smuggled into the payload', async () => {
      client.mget.mockResolvedValue([
        JSON.stringify({
          ...value,
          generation: 0,
          refreshTokenHash: 'should-never-appear',
          previousRefreshTokenHash: 'should-never-appear-either',
        }),
        null,
      ]);

      const result = await cache.read('session-1', 'user-1');

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('refreshTokenHash');
      expect(result).not.toHaveProperty('previousRefreshTokenHash');
    });
  });

  describe('write', () => {
    it('embeds the current generation and sets the key with the given TTL', async () => {
      client.get.mockResolvedValue('4');
      client.set.mockResolvedValue('OK');

      await cache.write('session-1', value, 120);

      expect(client.set).toHaveBeenCalledTimes(1);
      const [, payload, mode, ttl] = client.set.mock.calls[0];
      expect(mode).toBe('EX');
      expect(ttl).toBe(120);
      expect(JSON.parse(payload)).toEqual({ ...value, generation: 4 });
    });

    it('treats an absent generation key as generation 0', async () => {
      client.get.mockResolvedValue(null);
      client.set.mockResolvedValue('OK');

      await cache.write('session-1', value, 120);

      const payload = client.set.mock.calls[0][1];
      expect(JSON.parse(payload)).toMatchObject({ generation: 0 });
    });

    it('writes nothing when the ttl has no useful life left', async () => {
      await cache.write('session-1', value, 0);
      await cache.write('session-1', value, -5);

      expect(client.get).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
    });

    it('swallows a client error rather than throwing, and logs a warning', async () => {
      client.get.mockResolvedValue('0');
      client.set.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(cache.write('session-1', value, 120)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('invalidateSession', () => {
    it('deletes the session key', async () => {
      client.del.mockResolvedValue(1);

      await cache.invalidateSession('session-1');

      expect(client.del).toHaveBeenCalledTimes(1);
    });

    it('swallows a client error rather than throwing', async () => {
      client.del.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(cache.invalidateSession('session-1')).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('invalidateUser', () => {
    it('increments the per-user generation counter, and touches no session key directly', async () => {
      client.incr.mockResolvedValue(1);

      await cache.invalidateUser('user-1');

      expect(client.incr).toHaveBeenCalledTimes(1);
      expect(client.del).not.toHaveBeenCalled();
    });

    it('swallows a client error rather than throwing', async () => {
      client.incr.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(cache.invalidateUser('user-1')).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('revocation round trip, against a real (in-memory) client', () => {
    it('a session written before invalidateUser is unreadable afterwards, without any key enumeration', async () => {
      const real = new InMemoryRedisClient();
      const realCache = new RedisSessionCache(real, logger);

      await realCache.write('session-1', value, 300);
      await expect(realCache.read('session-1', 'user-1')).resolves.toEqual(value);

      await realCache.invalidateUser('user-1');

      await expect(realCache.read('session-1', 'user-1')).resolves.toBeNull();
    });

    it('invalidateSession removes exactly that session, leaving the others of the same user readable', async () => {
      const real = new InMemoryRedisClient();
      const realCache = new RedisSessionCache(real, logger);

      await realCache.write('session-1', value, 300);
      await realCache.write('session-2', { ...value, deviceId: 'device-2' }, 300);

      await realCache.invalidateSession('session-1');

      await expect(realCache.read('session-1', 'user-1')).resolves.toBeNull();
      await expect(realCache.read('session-2', 'user-1')).resolves.toEqual({
        ...value,
        deviceId: 'device-2',
      });
    });
  });
});

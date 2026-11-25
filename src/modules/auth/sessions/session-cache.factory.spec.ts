import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { NoopSessionCache } from './noop-session-cache';
import { RedisSessionCache } from './redis-session-cache';

const onMock = jest.fn();
const redisConstructor = jest.fn().mockImplementation(() => ({ on: onMock }));

// The factory must never open a real socket in a unit test — this stands in for the ioredis
// client entirely, the same way `jest.mock` stands in for any other network dependency here.
// `default` has to be a real `function`, not an arrow: `session-cache.factory.ts` calls
// `new Redis(...)`, and an arrow function cannot be invoked with `new` at all — it would throw
// "Redis is not a constructor" before the mock ever ran. A plain function that explicitly
// `return`s an object satisfies `new`'s own override rule instead of using `this`.
jest.mock('ioredis', () => ({
  __esModule: true,
  default: function MockRedis(...args: unknown[]): unknown {
    return redisConstructor(...args) as unknown;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must import after jest.mock registers the ioredis mock
const { createSessionCache } = require('./session-cache.factory') as {
  createSessionCache: (config: ReturnType<typeof createMockConfig>, logger: PinoLogger) => unknown;
};

describe('createSessionCache', () => {
  let logger: jest.Mocked<PinoLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createMockLogger();
  });

  it('binds the noop cache when SESSION_CACHE_ENABLED is false', () => {
    const cache = createSessionCache(createMockConfig({ SESSION_CACHE_ENABLED: false }), logger);

    expect(cache).toBeInstanceOf(NoopSessionCache);
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it('binds the noop cache when SESSION_CACHE_ENABLED is absent — the flag-absent default', () => {
    const cache = createSessionCache(createMockConfig({}), logger);

    expect(cache).toBeInstanceOf(NoopSessionCache);
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it('binds the Redis cache when SESSION_CACHE_ENABLED is true, reusing the REDIS_* settings', () => {
    const cache = createSessionCache(
      createMockConfig({
        SESSION_CACHE_ENABLED: true,
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: 6380,
        REDIS_PASSWORD: 'secret',
        REDIS_TLS: true,
      }),
      logger,
    );

    expect(cache).toBeInstanceOf(RedisSessionCache);
    expect(redisConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'redis.internal',
        port: 6380,
        password: 'secret',
        tls: {},
      }),
    );
  });

  it('omits tls when REDIS_TLS is false', () => {
    createSessionCache(
      createMockConfig({
        SESSION_CACHE_ENABLED: true,
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_TLS: false,
      }),
      logger,
    );

    const options = redisConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(options).not.toHaveProperty('tls');
  });

  it('attaches an error listener, so a connection failure never becomes an unhandled error', () => {
    createSessionCache(
      createMockConfig({ SESSION_CACHE_ENABLED: true, REDIS_HOST: 'localhost', REDIS_PORT: 6379 }),
      logger,
    );

    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));

    const handler = onMock.mock.calls[0][1] as (error: Error) => void;
    handler(new Error('ECONNREFUSED'));

    expect(logger.warn).toHaveBeenCalled();
  });
});

import { createHash } from 'node:crypto';
import { AuthEventsService } from '../auth-events.service';
import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { ServiceResponse } from '../../../common/types/service-response';
import { User, UserRole } from '../../../infra/prisma/prisma-client';
import {
  AUTH_SETTINGS_DEFAULTS,
  AuthSettingsService,
  ResolvedAuthSettings,
} from '../settings/auth-settings.service';
import { AccessTokenService } from '../tokens/access-token.service';
import { CachedSessionValue } from './session-cache.port';
import { SessionRepository, SessionWithUser } from './session.repository';
import { IssuedSession, SessionService, ValidatedSession } from './session.service';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const RAW_TOKEN = 'raw-refresh-token';
const DEVICE = 'device-1';
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.4';

/** Hashed here rather than through the production helper, so the test states the algorithm. */
const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('base64url');

const resolvedSettings = (overrides: Partial<ResolvedAuthSettings> = {}): ResolvedAuthSettings => ({
  ...AUTH_SETTINGS_DEFAULTS,
  ...overrides,
});

const makeUser = (overrides: Record<string, unknown> = {}): User =>
  ({
    id: 'user-1',
    email: 'shopper@example.com',
    phone: null,
    fullName: 'Aisha Rahman',
    role: UserRole.CUSTOMER,
    isActive: true,
    ...overrides,
  }) as unknown as User;

const makeSession = (overrides: Record<string, unknown> = {}): SessionWithUser => ({
  id: 'session-1',
  userId: 'user-1',
  refreshTokenHash: sha256(RAW_TOKEN),
  previousRefreshTokenHash: null,
  previousRotatedAt: null,
  expiresAt: new Date(NOW.getTime() + HOUR),
  absoluteExpiresAt: new Date(NOW.getTime() + 48 * HOUR),
  revokedAt: null,
  lastUsedAt: null,
  deviceId: DEVICE,
  userAgent: 'jest',
  ipAddress: IP,
  createdAt: NOW,
  user: makeUser(),
  ...overrides,
});

const makeClaims = (overrides: Record<string, unknown> = {}) =>
  ({
    userId: 'user-1',
    sessionId: 'session-1',
    role: UserRole.CUSTOMER,
    email: 'shopper@example.com',
    type: 'access',
    ...overrides,
  }) as Parameters<SessionService['validate']>[0];

const makeCachedValue = (overrides: Partial<CachedSessionValue> = {}): CachedSessionValue => ({
  userId: 'user-1',
  role: UserRole.CUSTOMER,
  email: 'shopper@example.com',
  phone: null,
  isActive: true,
  deviceId: DEVICE,
  expiresAt: new Date(NOW.getTime() + HOUR).toISOString(),
  absoluteExpiresAt: new Date(NOW.getTime() + 48 * HOUR).toISOString(),
  revokedAt: null,
  ...overrides,
});

const issued = (response: ServiceResponse<IssuedSession>): IssuedSession => {
  if (!response.ok) {
    throw new Error(`expected a session, got ${response.status}: ${response.message}`);
  }
  return response.data;
};

const failure = (response: ServiceResponse<unknown>): { status: number; message: string } => {
  if (response.ok) {
    throw new Error('expected a failure, got a success');
  }
  return { status: response.status, message: response.message };
};

describe('SessionService', () => {
  let repository: {
    create: jest.Mock;
    findByIdWithUser: jest.Mock;
    findByRefreshHash: jest.Mock;
    rotate: jest.Mock;
    touch: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
    listLiveForUser: jest.Mock;
    hasDeviceHistory: jest.Mock;
  };
  let settings: { current: jest.Mock };
  let cache: {
    read: jest.Mock;
    write: jest.Mock;
    invalidateSession: jest.Mock;
    invalidateUser: jest.Mock;
  };
  let tokens: AccessTokenService;
  let events: {
    recordLogin: jest.Mock;
    recordNewDevice: jest.Mock;
    recordLoginFailed: jest.Mock;
    recordMfaFailed: jest.Mock;
    recordLogout: jest.Mock;
    recordSessionRevoked: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let service: SessionService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    repository = {
      // Echoes the deadlines it was handed, so `issue`'s `refreshExpiresAt` is pinned to the
      // idle deadline that was actually written. A fixed row would let the service return the
      // absolute ceiling instead and every assertion would still pass.
      create: jest.fn().mockImplementation((data: { expiresAt: Date; absoluteExpiresAt: Date }) =>
        Promise.resolve(
          makeSession({
            expiresAt: data.expiresAt,
            absoluteExpiresAt: data.absoluteExpiresAt,
          }),
        ),
      ),
      findByIdWithUser: jest.fn().mockResolvedValue(makeSession()),
      findByRefreshHash: jest.fn().mockResolvedValue(makeSession()),
      rotate: jest
        .fn()
        .mockImplementation(
          (_id: string, nextHash: string, previousHash: string, expiresAt: Date) =>
            Promise.resolve(
              makeSession({
                refreshTokenHash: nextHash,
                previousRefreshTokenHash: previousHash,
                previousRotatedAt: new Date(),
                expiresAt,
              }),
            ),
        ),
      touch: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(true),
      revokeAllForUser: jest.fn().mockResolvedValue(2),
      listLiveForUser: jest.fn().mockResolvedValue([makeSession()]),
      hasDeviceHistory: jest.fn().mockResolvedValue(true),
    };
    settings = { current: jest.fn().mockResolvedValue(resolvedSettings()) };
    // Defaults to a miss on every read, so every pre-existing `validate` test below continues
    // to exercise the database path exactly as it did before this cache existed.
    cache = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
      invalidateSession: jest.fn().mockResolvedValue(undefined),
      invalidateUser: jest.fn().mockResolvedValue(undefined),
    };
    // The real token service, not a stub: "returns a working access token" is only worth
    // asserting if the thing that verifies it is the thing that will verify it in production.
    tokens = new AccessTokenService(
      createMockConfig({
        JWT_SECRET: 'a'.repeat(32),
        JWT_ISSUER: 'barakah-bazaar-api',
        JWT_AUDIENCE: 'barakah-bazaar',
      }),
      createMockLogger(),
    );
    events = {
      recordLogin: jest.fn().mockResolvedValue(undefined),
      recordNewDevice: jest.fn().mockResolvedValue(undefined),
      recordLoginFailed: jest.fn().mockResolvedValue(undefined),
      recordMfaFailed: jest.fn().mockResolvedValue(undefined),
      recordLogout: jest.fn().mockResolvedValue(undefined),
      recordSessionRevoked: jest.fn().mockResolvedValue(undefined),
    };
    logger = createMockLogger();
    service = new SessionService(
      repository as unknown as SessionRepository,
      tokens,
      settings as unknown as AuthSettingsService,
      events as unknown as AuthEventsService,
      cache,
      logger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('issue', () => {
    it('returns a refresh token that is never what was stored', async () => {
      const session = issued(await service.issue(makeUser(), DEVICE, 'jest', IP));
      const stored = repository.create.mock.calls[0][0].refreshTokenHash as string;

      expect(stored).not.toBe(session.refreshToken);
      expect(stored).toBe(sha256(session.refreshToken));
    });

    it('gives a customer the customer idle window and a staff member the staff one', async () => {
      await service.issue(makeUser(), DEVICE, null, null);
      const customer = repository.create.mock.calls[0][0] as Record<string, Date>;

      await service.issue(makeUser({ role: UserRole.OPS }), DEVICE, null, null);
      const staff = repository.create.mock.calls[1][0] as Record<string, Date>;

      expect(customer.expiresAt).toEqual(new Date(NOW.getTime() + 43_200 * MINUTE));
      expect(customer.absoluteExpiresAt).toEqual(new Date(NOW.getTime() + 129_600 * MINUTE));
      expect(staff.expiresAt).toEqual(new Date(NOW.getTime() + 720 * MINUTE));
      expect(staff.absoluteExpiresAt).toEqual(new Date(NOW.getTime() + 10_080 * MINUTE));
    });

    it('records the sign-in against the new session', async () => {
      const user = makeUser({ role: UserRole.OPS });

      await service.issue(user, DEVICE, 'jest', IP);

      expect(events.recordLogin).toHaveBeenCalledWith(user, {
        sessionId: 'session-1',
        deviceId: DEVICE,
        userAgent: 'jest',
        ip: IP,
      });
    });

    it('records a device this account has not used before, alongside the sign-in', async () => {
      repository.hasDeviceHistory.mockResolvedValue(false);

      await service.issue(makeUser({ role: UserRole.OPS }), DEVICE, 'jest', IP);

      expect(events.recordNewDevice).toHaveBeenCalledTimes(1);
      expect(events.recordLogin).toHaveBeenCalledTimes(1);
    });

    it('excludes the session it just opened from the device history, or every device is old', async () => {
      await service.issue(makeUser({ role: UserRole.OPS }), DEVICE, 'jest', IP);

      expect(repository.hasDeviceHistory).toHaveBeenCalledWith('user-1', DEVICE, 'session-1');
    });

    it('claims nothing about the device when the history read failed', async () => {
      // A database hiccup must not raise a new-device alert on a laptop used for a year.
      repository.hasDeviceHistory.mockResolvedValue(null);

      await service.issue(makeUser({ role: UserRole.OPS }), DEVICE, 'jest', IP);

      expect(events.recordNewDevice).not.toHaveBeenCalled();
    });

    it('does not spend a device-history query on a customer, whose events are never recorded', async () => {
      await service.issue(makeUser(), DEVICE, 'jest', IP);

      expect(repository.hasDeviceHistory).not.toHaveBeenCalled();
    });

    it('sets the access token expiry from settings, not from the refresh window', async () => {
      settings.current.mockResolvedValue(resolvedSettings({ accessTokenMinutes: 15 }));

      const session = issued(await service.issue(makeUser(), DEVICE, 'jest', IP));

      expect(session.expiresAt).toEqual(new Date(NOW.getTime() + 15 * MINUTE));
      expect(session.expiresAt).not.toEqual(session.refreshExpiresAt);
    });

    it('reports the refresh expiry as the idle deadline it wrote, not the ceiling', async () => {
      const session = issued(await service.issue(makeUser(), DEVICE, 'jest', IP));
      const written = repository.create.mock.calls[0][0] as Record<string, Date>;

      expect(session.refreshExpiresAt).toEqual(new Date(NOW.getTime() + 43_200 * MINUTE));
      expect(session.refreshExpiresAt).toEqual(written.expiresAt);
      expect(session.refreshExpiresAt).not.toEqual(written.absoluteExpiresAt);
    });

    it('records the device, user agent and ip on the row', async () => {
      await service.issue(makeUser(), 'device-9', 'Chrome/141', OTHER_IP);

      expect(repository.create.mock.calls[0][0]).toMatchObject({
        userId: 'user-1',
        deviceId: 'device-9',
        userAgent: 'Chrome/141',
        ipAddress: OTHER_IP,
      });
    });

    it('reports 503 when the session row cannot be written', async () => {
      repository.create.mockResolvedValue(null);

      expect(failure(await service.issue(makeUser(), DEVICE, 'jest', IP)).status).toBe(503);
    });

    it('reports 500 when signing throws, and never returns a token', async () => {
      jest.spyOn(tokens, 'sign').mockRejectedValue(new Error('boom'));

      expect(failure(await service.issue(makeUser(), DEVICE, 'jest', IP)).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('validate', () => {
    const validated = (response: ServiceResponse<ValidatedSession>): ValidatedSession => {
      if (!response.ok) {
        throw new Error(`expected a validated session, got ${response.status}`);
      }
      return response.data;
    };

    it('accepts a live session and returns its user', async () => {
      const result = validated(await service.validate(makeClaims(), DEVICE));

      expect(result.sessionId).toBe('session-1');
      expect(result.user.id).toBe('user-1');
    });

    it('refuses a revoked session', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ revokedAt: new Date(NOW.getTime() - MINUTE) }),
      );

      expect(failure(await service.validate(makeClaims(), DEVICE))).toEqual({
        status: 401,
        message: 'Your session is invalid or has expired. Please sign in again.',
      });
    });

    it('refuses a session past its idle deadline', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ expiresAt: new Date(NOW.getTime() - MINUTE) }),
      );

      expect(failure(await service.validate(makeClaims(), DEVICE)).status).toBe(401);
    });

    it('refuses a session past its absolute cap even if the idle window is open', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({
          expiresAt: new Date(NOW.getTime() + HOUR),
          absoluteExpiresAt: new Date(NOW.getTime() - MINUTE),
        }),
      );

      expect(failure(await service.validate(makeClaims(), DEVICE)).status).toBe(401);
    });

    it('refuses when the device id differs from the row, and revokes the session', async () => {
      expect(failure(await service.validate(makeClaims(), 'device-2')).status).toBe(401);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('refuses a token whose subject does not own the session it names', async () => {
      expect(failure(await service.validate(makeClaims({ userId: 'user-2' }), DEVICE))).toEqual({
        status: 401,
        message: 'Your session is invalid or has expired. Please sign in again.',
      });
    });

    it('refuses a disabled account with 403, not 401', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ user: makeUser({ isActive: false }) }),
      );

      expect(failure(await service.validate(makeClaims(), DEVICE))).toEqual({
        status: 403,
        message: 'This account has been disabled. Please contact support.',
      });
    });

    it('slides the idle deadline forward when lastUsedAt is older than the interval', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({
          lastUsedAt: new Date(NOW.getTime() - 10 * MINUTE),
          absoluteExpiresAt: new Date(NOW.getTime() + 200_000 * MINUTE),
        }),
      );

      await service.validate(makeClaims(), DEVICE);

      expect(repository.touch).toHaveBeenCalledWith(
        'session-1',
        new Date(NOW.getTime() + 43_200 * MINUTE),
      );
    });

    it('does not write when lastUsedAt is inside the interval', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ lastUsedAt: new Date(NOW.getTime() - MINUTE) }),
      );

      await service.validate(makeClaims(), DEVICE);

      expect(repository.touch).not.toHaveBeenCalled();
    });

    it('caps the slid deadline at the absolute expiry', async () => {
      const ceiling = new Date(NOW.getTime() + HOUR);
      repository.findByIdWithUser.mockResolvedValue(makeSession({ absoluteExpiresAt: ceiling }));

      await service.validate(makeClaims(), DEVICE);

      expect(repository.touch).toHaveBeenCalledWith('session-1', ceiling);
    });

    it('reports 503 when the lookup fails, and 401 when the row is simply absent', async () => {
      repository.findByIdWithUser.mockResolvedValue(null);
      expect(failure(await service.validate(makeClaims(), DEVICE)).status).toBe(503);

      repository.findByIdWithUser.mockResolvedValue(undefined);
      expect(failure(await service.validate(makeClaims(), DEVICE)).status).toBe(401);
    });

    it('reports 500 when the lookup throws outright', async () => {
      repository.findByIdWithUser.mockRejectedValue(new Error('boom'));

      expect(failure(await service.validate(makeClaims(), DEVICE)).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('validate — session cache', () => {
    const validated = (response: ServiceResponse<ValidatedSession>): ValidatedSession => {
      if (!response.ok) {
        throw new Error(`expected a validated session, got ${response.status}`);
      }
      return response.data;
    };

    it('accepts a cache hit without touching the database', async () => {
      cache.read.mockResolvedValue(makeCachedValue());

      const result = validated(await service.validate(makeClaims(), DEVICE));

      expect(result.sessionId).toBe('session-1');
      expect(result.user).toEqual({
        id: 'user-1',
        email: 'shopper@example.com',
        phone: null,
        role: UserRole.CUSTOMER,
        isActive: true,
      });
      expect(repository.findByIdWithUser).not.toHaveBeenCalled();
      expect(cache.read).toHaveBeenCalledWith('session-1', 'user-1');
    });

    it('refuses a cached session marked revoked, without consulting the database', async () => {
      cache.read.mockResolvedValue(makeCachedValue({ revokedAt: NOW.toISOString() }));

      expect(failure(await service.validate(makeClaims(), DEVICE))).toEqual({
        status: 401,
        message: 'Your session is invalid or has expired. Please sign in again.',
      });
      expect(repository.findByIdWithUser).not.toHaveBeenCalled();
    });

    it('refuses a cached session past its idle deadline', async () => {
      cache.read.mockResolvedValue(
        makeCachedValue({ expiresAt: new Date(NOW.getTime() - MINUTE).toISOString() }),
      );

      expect(failure(await service.validate(makeClaims(), DEVICE)).status).toBe(401);
    });

    it('refuses a cached session past its absolute cap even if the idle window is open', async () => {
      cache.read.mockResolvedValue(
        makeCachedValue({
          expiresAt: new Date(NOW.getTime() + HOUR).toISOString(),
          absoluteExpiresAt: new Date(NOW.getTime() - MINUTE).toISOString(),
        }),
      );

      expect(failure(await service.validate(makeClaims(), DEVICE)).status).toBe(401);
    });

    it('refuses a cache hit from a different device, revokes it, and drops the cache entry', async () => {
      cache.read.mockResolvedValue(makeCachedValue());

      expect(failure(await service.validate(makeClaims(), 'device-2')).status).toBe(401);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
      expect(cache.invalidateSession).toHaveBeenCalledWith('session-1');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('records why a cached session was revoked, using the identity the cache already holds', async () => {
      // No database read to name the actor: the cached value carries id, email and role.
      cache.read.mockResolvedValue(makeCachedValue({ role: UserRole.OPS }));

      await service.validate(makeClaims(), 'device-2');

      expect(events.recordSessionRevoked).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', role: UserRole.OPS }),
        'session-1',
        'device_mismatch',
      );
    });

    it('refuses a cached disabled account with 403, not 401', async () => {
      cache.read.mockResolvedValue(makeCachedValue({ isActive: false }));

      expect(failure(await service.validate(makeClaims(), DEVICE))).toEqual({
        status: 403,
        message: 'This account has been disabled. Please contact support.',
      });
    });

    it('falls back to the database when the cache errors, rather than accepting the session', async () => {
      cache.read.mockRejectedValue(new Error('redis unreachable'));

      const result = validated(await service.validate(makeClaims(), DEVICE));

      expect(result.sessionId).toBe('session-1');
      expect(repository.findByIdWithUser).toHaveBeenCalledWith('session-1');
    });

    it('populates the cache after a database-served validation succeeds', async () => {
      await service.validate(makeClaims(), DEVICE);

      expect(cache.write).toHaveBeenCalledTimes(1);
      const [sessionId, value, ttlSeconds] = cache.write.mock.calls[0] as [
        string,
        CachedSessionValue,
        number,
      ];
      expect(sessionId).toBe('session-1');
      expect(value).toEqual(makeCachedValue());
      expect(ttlSeconds).toBe(300);
    });

    it('caps the cache TTL at the session ceiling, not at the (much larger) absolute expiry', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ absoluteExpiresAt: new Date(NOW.getTime() + 48 * HOUR) }),
      );

      await service.validate(makeClaims(), DEVICE);

      const ttlSeconds = cache.write.mock.calls[0][2] as number;
      expect(ttlSeconds).toBe(300);
    });

    it('caps the cache TTL at the remaining absolute life when that is shorter than the ceiling', async () => {
      const almostOver = new Date(NOW.getTime() + 90_000);
      repository.findByIdWithUser.mockResolvedValue(makeSession({ absoluteExpiresAt: almostOver }));

      await service.validate(makeClaims(), DEVICE);

      const ttlSeconds = cache.write.mock.calls[0][2] as number;
      expect(ttlSeconds).toBe(90);
    });

    it('never writes to the cache once the session is already past its absolute expiry', async () => {
      // Rejected by `assertUsable` before `cacheSession` is ever reached, so this mostly
      // documents the ordinary case. The genuinely load-bearing guard is the next test.
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({
          expiresAt: new Date(NOW.getTime() + HOUR),
          absoluteExpiresAt: new Date(NOW.getTime() - MINUTE),
        }),
      );

      await service.validate(makeClaims(), DEVICE);

      expect(cache.write).not.toHaveBeenCalled();
    });

    it('never writes to the cache when less than a second of absolute life remains, even though the session is still valid', async () => {
      // A session with sub-second remaining life passes `assertUsable` (its absolute deadline
      // has not yet arrived) but must still not be cached: `Math.floor` on the remaining
      // milliseconds rounds this down to a TTL of 0, and `cacheSession` must treat that exactly
      // like a negative TTL rather than caching it for one full ceiling-length TTL by accident.
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ absoluteExpiresAt: new Date(NOW.getTime() + 500) }),
      );

      await service.validate(makeClaims(), DEVICE);

      expect(cache.write).not.toHaveBeenCalled();
    });

    it('never populates refreshTokenHash or previousRefreshTokenHash into the cache', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ previousRefreshTokenHash: sha256('some-previous-token') }),
      );

      await service.validate(makeClaims(), DEVICE);

      const value = cache.write.mock.calls[0][1] as Record<string, unknown>;
      expect(value.refreshTokenHash).toBeUndefined();
      expect(value.previousRefreshTokenHash).toBeUndefined();
    });
  });

  describe('refresh', () => {
    const rotatedSession = (rotatedAgo: number): SessionWithUser =>
      makeSession({
        refreshTokenHash: sha256('token-that-replaced-it'),
        previousRefreshTokenHash: sha256(RAW_TOKEN),
        previousRotatedAt: new Date(NOW.getTime() - rotatedAgo),
      });

    it('rotates: a new refresh token, the old hash kept as previous', async () => {
      const session = issued(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP));
      const [id, nextHash, previousHash] = repository.rotate.mock.calls[0] as [
        string,
        string,
        string,
      ];

      expect(id).toBe('session-1');
      expect(previousHash).toBe(sha256(RAW_TOKEN));
      expect(session.refreshToken).not.toBe(RAW_TOKEN);
      expect(nextHash).toBe(sha256(session.refreshToken));
    });

    it('returns a working new access token', async () => {
      const session = issued(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP));

      await expect(tokens.verify(session.accessToken, DEVICE, 'access')).resolves.toMatchObject({
        ok: true,
        claims: { userId: 'user-1', sessionId: 'session-1', role: UserRole.CUSTOMER },
      });
    });

    it('records the client seen on the rotating request', async () => {
      await service.refresh(RAW_TOKEN, DEVICE, 'Chrome/141', OTHER_IP);

      expect(repository.rotate.mock.calls[0][4]).toEqual({
        userAgent: 'Chrome/141',
        ipAddress: OTHER_IP,
      });
    });

    it('caps the extended idle deadline at the absolute expiry', async () => {
      const ceiling = new Date(NOW.getTime() + HOUR);
      repository.findByRefreshHash.mockResolvedValue(makeSession({ absoluteExpiresAt: ceiling }));

      await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP);

      expect(repository.rotate.mock.calls[0][3]).toEqual(ceiling);
    });

    it('accepts a previous token inside the reuse grace window and does NOT revoke', async () => {
      repository.findByRefreshHash.mockResolvedValue(rotatedSession(10_000));

      const session = issued(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP));

      expect(repository.revoke).not.toHaveBeenCalled();
      expect(repository.rotate).not.toHaveBeenCalled();
      expect(session.refreshToken).toBe(RAW_TOKEN);
      await expect(tokens.verify(session.accessToken, DEVICE, 'access')).resolves.toMatchObject({
        ok: true,
        claims: { sessionId: 'session-1' },
      });
    });

    it('reports 500 when signing fails on the grace path, rather than escaping the handler', async () => {
      repository.findByRefreshHash.mockResolvedValue(rotatedSession(10_000));
      jest.spyOn(tokens, 'sign').mockRejectedValue(new Error('boom'));

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it('revokes the session when a previous token is presented outside the grace window', async () => {
      repository.findByRefreshHash.mockResolvedValue(rotatedSession(31_000));

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(401);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('treats a previous hash with no rotation stamp as a replay, not as forgiven', async () => {
      repository.findByRefreshHash.mockResolvedValue(
        makeSession({
          refreshTokenHash: sha256('token-that-replaced-it'),
          previousRefreshTokenHash: sha256(RAW_TOKEN),
          previousRotatedAt: null,
        }),
      );

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(401);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
    });

    it('treats a future-dated rotation stamp as a replay, not as inside the window', async () => {
      // The stamp is written by the application clock, so a host that ran ahead leaves one
      // later than now. A negative elapsed time must not read as "well inside the window".
      repository.findByRefreshHash.mockResolvedValue(rotatedSession(-HOUR));

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(401);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('clamps an absurd configured grace window instead of trusting it', async () => {
      // A mistyped `86400` would otherwise forgive a replay for a full day.
      settings.current.mockResolvedValue(resolvedSettings({ refreshReuseGraceSeconds: 86_400 }));
      repository.findByRefreshHash.mockResolvedValue(rotatedSession(10 * 60_000));

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(401);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
    });

    it('never serves the grace path for a hash that matched neither slot', async () => {
      // Pins the coupling to `findByRefreshHash`, which returns a row only when the presented
      // hash matched one of the two columns. Were that ever refactored into a `findFirst` with
      // an `OR`, a hash matching *neither* must not be classified as a previous-generation
      // reuse and handed back re-blessed through the grace window.
      repository.findByRefreshHash.mockResolvedValue(
        makeSession({
          refreshTokenHash: sha256('a-current-token-nobody-presented'),
          previousRefreshTokenHash: sha256('a-previous-token-nobody-presented'),
          previousRotatedAt: new Date(NOW.getTime() - 1_000),
        }),
      );

      const result = await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP);

      expect(result.ok && result.data.refreshToken).not.toBe(RAW_TOKEN);
      expect(repository.rotate).toHaveBeenCalled();
    });

    it('answers a replay identically to an unknown token', async () => {
      repository.findByRefreshHash.mockResolvedValue(rotatedSession(31_000));
      const replay = failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP));

      repository.findByRefreshHash.mockResolvedValue(undefined);
      const unknown = failure(await service.refresh('never-issued', DEVICE, 'jest', IP));

      expect(replay).toEqual(unknown);
      expect(replay).toEqual({ status: 401, message: 'Those sign-in details are not correct.' });
    });

    it('refuses a refresh from a different device, and revokes', async () => {
      expect(failure(await service.refresh(RAW_TOKEN, 'device-2', 'jest', IP))).toEqual({
        status: 401,
        message: 'Those sign-in details are not correct.',
      });
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
      expect(repository.rotate).not.toHaveBeenCalled();
    });

    it('records the device mismatch that ended the session', async () => {
      await service.refresh(RAW_TOKEN, 'device-2', 'jest', IP);

      expect(events.recordSessionRevoked).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        'session-1',
        'device_mismatch',
      );
    });

    it('refuses a disabled account', async () => {
      repository.findByRefreshHash.mockResolvedValue(
        makeSession({ user: makeUser({ isActive: false }) }),
      );

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP))).toEqual({
        status: 403,
        message: 'This account has been disabled. Please contact support.',
      });
      expect(repository.rotate).not.toHaveBeenCalled();
    });

    it('refuses an expired session without rotating it', async () => {
      repository.findByRefreshHash.mockResolvedValue(
        makeSession({ expiresAt: new Date(NOW.getTime() - MINUTE) }),
      );

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(401);
      expect(repository.rotate).not.toHaveBeenCalled();
    });

    it('reports 503 when the rotation cannot be written, and hands back no token', async () => {
      repository.rotate.mockResolvedValue(null);

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(503);
    });

    it('reports 503 when the lookup fails', async () => {
      repository.findByRefreshHash.mockResolvedValue(null);

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(503);
    });

    it('reports 500 when the lookup throws, without logging the token', async () => {
      repository.findByRefreshHash.mockRejectedValue(new Error('boom'));

      expect(failure(await service.refresh(RAW_TOKEN, DEVICE, 'jest', IP)).status).toBe(500);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(RAW_TOKEN);
    });

    /**
     * The bug this whole design exists to prevent: five requests from one client, overlapping
     * in time, all carrying the token that was current when the first of them was sent.
     *
     * The repository here is a real, mutable row — `rotate` applies the same compare-and-swap
     * the production predicate does, and `findByRefreshHash` answers from whatever the row
     * currently holds — so the four later requests genuinely resolve through the previous-hash
     * slot rather than through a stub that cannot tell the two columns apart. They are
     * staggered by a tick because that is what a database does: it serialises the read against
     * the write already in flight on that row.
     */
    it('serves five overlapping refreshes of one token generation with a single rotation', async () => {
      const live = makeSession();

      repository.findByRefreshHash = jest.fn((presented: string) =>
        Promise.resolve(
          presented === live.refreshTokenHash || presented === live.previousRefreshTokenHash
            ? { ...live }
            : undefined,
        ),
      );
      repository.rotate = jest.fn(
        (_id: string, nextHash: string, previousHash: string, expiresAt: Date) => {
          if (live.refreshTokenHash !== previousHash || live.revokedAt !== null) {
            return Promise.resolve(null);
          }
          Object.assign(live, {
            refreshTokenHash: nextHash,
            previousRefreshTokenHash: previousHash,
            previousRotatedAt: new Date(),
            expiresAt,
          });
          return Promise.resolve({ ...live });
        },
      );
      repository.revoke = jest.fn(() => {
        Object.assign(live, { revokedAt: new Date() });
        return Promise.resolve(true);
      });
      service = new SessionService(
        repository as unknown as SessionRepository,
        tokens,
        settings as unknown as AuthSettingsService,
        events as unknown as AuthEventsService,
        cache,
        logger,
      );

      const inFlight = Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          new Promise<void>((resolve) => setTimeout(resolve, index * 5)).then(() =>
            service.refresh(RAW_TOKEN, DEVICE, 'jest', IP),
          ),
        ),
      );
      await jest.advanceTimersByTimeAsync(5 * 5);
      const results = await inFlight;

      expect(results.map((result) => result.ok)).toEqual([true, true, true, true, true]);
      expect(repository.rotate).toHaveBeenCalledTimes(1);
      expect(repository.revoke).not.toHaveBeenCalled();
      expect(live.revokedAt).toBeNull();

      // Every token handed out is still one the session will accept.
      const lookup = repository.findByRefreshHash as unknown as (
        hash: string,
      ) => Promise<SessionWithUser | undefined>;
      const resolvable = await Promise.all(
        results.map((result) => lookup(sha256(issued(result).refreshToken))),
      );
      expect(resolvable.every((session) => session !== undefined)).toBe(true);
    });
  });

  describe('revokeOnDeviceMismatch', () => {
    it('ends the session and records why', async () => {
      const session = makeSession({ id: 'session-1' });
      repository.findByIdWithUser.mockResolvedValue(session);

      await service.revokeOnDeviceMismatch('session-1');

      expect(repository.revoke).toHaveBeenCalledWith('session-1');
      expect(cache.invalidateSession).toHaveBeenCalledWith('session-1');
      expect(events.recordSessionRevoked).toHaveBeenCalledWith(
        session.user,
        'session-1',
        'device_mismatch',
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it('writes nothing for a session that is already revoked', async () => {
      // A leaked token replayed in a loop would otherwise write one audit row per attempt,
      // which is a log-flooding vector handed to whoever holds it.
      repository.findByIdWithUser.mockResolvedValue(makeSession({ revokedAt: new Date() }));

      await service.revokeOnDeviceMismatch('session-1');

      expect(repository.revoke).not.toHaveBeenCalled();
      expect(events.recordSessionRevoked).not.toHaveBeenCalled();
    });

    it('writes nothing for a session that does not exist', async () => {
      repository.findByIdWithUser.mockResolvedValue(undefined);

      await service.revokeOnDeviceMismatch('session-1');

      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('writes nothing when the lookup itself failed', async () => {
      repository.findByIdWithUser.mockResolvedValue(null);

      await service.revokeOnDeviceMismatch('session-1');

      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('never throws, because the guard is answering 401 either way', async () => {
      repository.findByIdWithUser.mockRejectedValue(new Error('connection reset'));

      await expect(service.revokeOnDeviceMismatch('session-1')).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('never logs anything that could identify the token', async () => {
      repository.findByIdWithUser.mockResolvedValue(makeSession());

      await service.revokeOnDeviceMismatch('session-1');

      const logged = JSON.stringify(logger.warn.mock.calls);

      expect(logged).toContain('session-1');
      expect(logged).not.toContain(RAW_TOKEN);
    });
  });

  describe('revoke', () => {
    const actor = { id: 'user-1', email: 'ops@example.com', role: UserRole.OPS };

    it('ends the session', async () => {
      expect((await service.revoke('session-1')).ok).toBe(true);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
    });

    it('records the sign-out when the caller identified themselves', async () => {
      await service.revoke('session-1', actor);

      expect(events.recordLogout).toHaveBeenCalledWith(actor, 'session-1');
    });

    it('records nothing when no actor was supplied, so an internal revoke is not a logout', async () => {
      await service.revoke('session-1');

      expect(events.recordLogout).not.toHaveBeenCalled();
    });

    it('records no sign-out when the write failed', async () => {
      repository.revoke.mockResolvedValue(false);

      await service.revoke('session-1', actor);

      expect(events.recordLogout).not.toHaveBeenCalled();
    });

    it('reports 503 when the write failed, because the session may still be live', async () => {
      repository.revoke.mockResolvedValue(false);

      expect(failure(await service.revoke('session-1'))).toEqual({
        status: 503,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('reports 500 when the repository throws', async () => {
      repository.revoke.mockRejectedValue(new Error('boom'));

      expect(failure(await service.revoke('session-1')).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it('drops the cached entry once the database revoke commits', async () => {
      await service.revoke('session-1');

      expect(cache.invalidateSession).toHaveBeenCalledWith('session-1');
    });

    it('does not touch the cache when the database write failed', async () => {
      repository.revoke.mockResolvedValue(false);

      await service.revoke('session-1');

      expect(cache.invalidateSession).not.toHaveBeenCalled();
    });
  });

  describe('revokeAll', () => {
    it('reports how many live sessions it ended', async () => {
      repository.revokeAllForUser.mockResolvedValue(3);

      const result = await service.revokeAll('user-1');

      expect(result).toEqual({ ok: true, data: 3 });
    });

    it('reports 503 rather than a cheerful zero when the write failed', async () => {
      repository.revokeAllForUser.mockResolvedValue(null);

      expect(failure(await service.revokeAll('user-1')).status).toBe(503);
    });

    it('records a full sign-out with its reason, not as a logout', async () => {
      const actor = { id: 'user-1', email: 'ops@example.com', role: UserRole.OPS };

      await service.revokeAll('user-1', actor);

      expect(events.recordSessionRevoked).toHaveBeenCalledWith(
        actor,
        'user-1',
        'all_sessions_ended',
      );
      expect(events.recordLogout).not.toHaveBeenCalled();
    });

    it('records nothing when the write failed', async () => {
      repository.revokeAllForUser.mockResolvedValue(null);

      await service.revokeAll('user-1', {
        id: 'user-1',
        email: 'ops@example.com',
        role: UserRole.OPS,
      });

      expect(events.recordSessionRevoked).not.toHaveBeenCalled();
    });

    it('reports 500 when the repository throws', async () => {
      repository.revokeAllForUser.mockRejectedValue(new Error('boom'));

      expect(failure(await service.revokeAll('user-1')).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it('bumps the user generation once every live session is revoked', async () => {
      await service.revokeAll('user-1');

      expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
    });

    it('does not bump the generation when the database write failed', async () => {
      repository.revokeAllForUser.mockResolvedValue(null);

      await service.revokeAll('user-1');

      expect(cache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('listForUser', () => {
    it('returns the live sessions the repository found', async () => {
      const rows = [makeSession({ id: 'session-1' }), makeSession({ id: 'session-2' })];
      repository.listLiveForUser.mockResolvedValue(rows);

      const result = await service.listForUser('user-1');

      expect(result).toEqual({ ok: true, data: rows });
      expect(repository.listLiveForUser).toHaveBeenCalledWith('user-1');
    });

    it('reports 503, not an empty list, when the repository read failed', async () => {
      repository.listLiveForUser.mockResolvedValue(null);

      expect(failure(await service.listForUser('user-1'))).toEqual({
        status: 503,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('reports 500 when the repository throws', async () => {
      repository.listLiveForUser.mockRejectedValue(new Error('boom'));

      expect(failure(await service.listForUser('user-1')).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('revokeOwned', () => {
    it('revokes a session the caller owns', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ id: 'session-1', userId: 'user-1' }),
      );

      const result = await service.revokeOwned('user-1', 'session-1');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
    });

    it('records ending another of your own devices as a revocation, not a sign-out', async () => {
      // Reads very differently in an incident review: the caller is ending a session they are
      // not currently using, which is the "I do not recognise that device" action.
      const session = makeSession({ id: 'session-1', userId: 'user-1' });
      repository.findByIdWithUser.mockResolvedValue(session);

      await service.revokeOwned('user-1', 'session-1');

      expect(events.recordSessionRevoked).toHaveBeenCalledWith(
        session.user,
        'session-1',
        'owner_revoked',
      );
      expect(events.recordLogout).not.toHaveBeenCalled();
    });

    it('answers 404, and never revokes, when the session belongs to someone else', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({ id: 'session-1', userId: 'user-2' }),
      );

      expect(failure(await service.revokeOwned('user-1', 'session-1'))).toEqual({
        status: 404,
        message: 'Session was not found.',
      });
      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('answers the same 404, and never revokes, when the session does not exist', async () => {
      repository.findByIdWithUser.mockResolvedValue(undefined);

      expect(failure(await service.revokeOwned('user-1', 'missing-session'))).toEqual({
        status: 404,
        message: 'Session was not found.',
      });
      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('reports 503 when the lookup itself fails', async () => {
      repository.findByIdWithUser.mockResolvedValue(null);

      expect(failure(await service.revokeOwned('user-1', 'session-1')).status).toBe(503);
      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('reports 500 when the repository throws', async () => {
      repository.findByIdWithUser.mockRejectedValue(new Error('boom'));

      expect(failure(await service.revokeOwned('user-1', 'session-1')).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it('is idempotent: revoking an already-revoked own session is still a success', async () => {
      repository.findByIdWithUser.mockResolvedValue(
        makeSession({
          id: 'session-1',
          userId: 'user-1',
          revokedAt: new Date(NOW.getTime() - MINUTE),
        }),
      );

      expect((await service.revokeOwned('user-1', 'session-1')).ok).toBe(true);
    });
  });

  describe('hashToken', () => {
    it('is the base64url sha256 of the raw token', () => {
      expect(SessionService.hashToken(RAW_TOKEN)).toBe(sha256(RAW_TOKEN));
    });

    it('never carries the raw token into anything issue writes', async () => {
      const session = issued(await service.issue(makeUser(), DEVICE, 'jest', IP));
      const written = JSON.stringify(repository.create.mock.calls[0][0]);

      expect(written).not.toContain(session.refreshToken);
    });
  });
});

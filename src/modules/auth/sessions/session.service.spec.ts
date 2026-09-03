import { createHash } from 'node:crypto';
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
  };
  let settings: { current: jest.Mock };
  let tokens: AccessTokenService;
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
    };
    settings = { current: jest.fn().mockResolvedValue(resolvedSettings()) };
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
    logger = createMockLogger();
    service = new SessionService(
      repository as unknown as SessionRepository,
      tokens,
      settings as unknown as AuthSettingsService,
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
        userId: 'user-1',
        sessionId: 'session-1',
        role: UserRole.CUSTOMER,
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
        sessionId: 'session-1',
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

  describe('revoke', () => {
    it('ends the session', async () => {
      expect((await service.revoke('session-1')).ok).toBe(true);
      expect(repository.revoke).toHaveBeenCalledWith('session-1');
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

    it('reports 500 when the repository throws', async () => {
      repository.revokeAllForUser.mockRejectedValue(new Error('boom'));

      expect(failure(await service.revokeAll('user-1')).status).toBe(500);
      expect(logger.error).toHaveBeenCalled();
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

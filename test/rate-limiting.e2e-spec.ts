import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import request from 'supertest';
import { ErrorResponseBody } from '../src/common/filters/global-exception.filter';

// ConfigModule.forRoot() reads and validates the environment at the moment app.module.ts is
// imported, not when the module is instantiated — so this has to be at module scope, before a
// dynamic import of AppModule inside beforeAll. See degraded-boot.e2e-spec.ts.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_JWKS_URL;
delete process.env.SUPABASE_JWT_SECRET;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Deliberately tiny, so a test crosses a limit in a handful of requests instead of sixty.
 * AUTH_IP is set *below* WRITE so the two can be told apart: login is a POST and therefore
 * sits in both buckets, and only the auth-ip limit biting first proves which one is in charge.
 * AUTH_ACCOUNT is set *above* AUTH_IP so a same-email-same-IP flood is bounded by auth-ip
 * first, which keeps that existing case deterministic while auth-account gets its own tests
 * below with a different caller shape (same account, many IPs).
 */
const AUTH_LIMIT = 3;
const AUTH_ACCOUNT_LIMIT = 5;
const WRITE_LIMIT = 4;
const GEOCODING_LIMIT = 2;

/**
 * Jest may run several spec files in one worker process, and `process.env` is shared across
 * them while the module registry is not. Limits this low would make any suite that follows
 * this one fail the moment it made a fifth write, so the previous values go back afterwards.
 */
const originalLimits = {
  AUTH_RATE_LIMIT: process.env.AUTH_RATE_LIMIT,
  AUTH_ACCOUNT_RATE_LIMIT: process.env.AUTH_ACCOUNT_RATE_LIMIT,
  WRITE_RATE_LIMIT: process.env.WRITE_RATE_LIMIT,
  GEOCODING_RATE_LIMIT: process.env.GEOCODING_RATE_LIMIT,
};

process.env.AUTH_RATE_LIMIT = String(AUTH_LIMIT);
process.env.AUTH_ACCOUNT_RATE_LIMIT = String(AUTH_ACCOUNT_LIMIT);
process.env.WRITE_RATE_LIMIT = String(WRITE_LIMIT);
process.env.GEOCODING_RATE_LIMIT = String(GEOCODING_LIMIT);

const HEALTH = '/api/v1/health';
const CART_ITEMS = '/api/v1/cart/items';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const GEO_SEARCH = '/api/v1/geo/search';
const GEO_DIVISIONS = '/api/v1/geo/divisions';

/** A stand-in caller IP used whenever a test does not care which IP it is, so requests do
 *  not depend on whatever address the local socket happens to report. */
const DEFAULT_IP = '198.51.100.1';

/** Comfortably past every limit above, so "unlimited" means unlimited and not merely roomy. */
const WELL_PAST_EVERY_LIMIT = 12;

const CART_BODY = { productId: '7d1b0c3e-5f42-4a89-9c6d-1e8b2a4f70d5', quantity: 1 };

/** Every login below is meant to fail; only the attempt is being counted, not the credential. */
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a deliberately invalid value, not a secret
const REJECTED_PASSWORD = 'rejected-by-design';

/**
 * Rate limiting, through the real request pipeline.
 *
 * This file exists because of a regression it would have caught: every named bucket was
 * applied to every route, so the login bucket's limit silently became the limit on the whole
 * API and any suite making more than ten requests to one endpoint started collecting 429s.
 * What is asserted here is which routes a bucket reaches — the unit specs already cover how
 * each bucket decides.
 */
describe('Rate limiting (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Test-only: lets X-Forwarded-For stand in for distinct caller IPs below, so the
    // per-IP and per-account buckets can be told apart without real distributed callers.
    // Never mirrored in main.ts — this suite never runs behind a real proxy to spoof.
    const expressInstance = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: unknown) => void;
    };
    expressInstance.set('trust proxy', true);
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    Object.entries(originalLimits).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }
      process.env[key] = value;
    });
  });

  // Buckets are keyed per endpoint per caller and every test here shares one app, so without
  // this a test would inherit whatever counts its predecessors left behind.
  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
  });

  const fire = async (times: number, send: () => request.Test): Promise<number[]> => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < times; attempt += 1) {
      statuses.push((await send()).status);
    }
    return statuses;
  };

  /** Like `fire`, but each call gets its own index — for a run where every attempt needs a
   *  distinct email or IP rather than repeating the same one. */
  const fireEach = async (
    times: number,
    send: (attempt: number) => request.Test,
  ): Promise<number[]> => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < times; attempt += 1) {
      statuses.push((await send(attempt)).status);
    }
    return statuses;
  };

  const postCartItem = () => request(app.getHttpServer()).post(CART_ITEMS).send(CART_BODY);

  const postLogin = (email: string, ip: string = DEFAULT_IP) =>
    request(app.getHttpServer())
      .post(LOGIN)
      .set('x-device-id', 'rate-limit-device')
      .set('X-Forwarded-For', ip)
      .send({ email, password: REJECTED_PASSWORD });

  /** Carries no email at all — the shape the account bucket must stay out of. */
  const postRefresh = (ip: string) =>
    request(app.getHttpServer())
      .post(REFRESH)
      .set('x-device-id', 'rate-limit-device')
      .set('X-Forwarded-For', ip)
      .send({ refreshToken: 'not-a-real-token' });

  describe('the write baseline', () => {
    it('caps a write route that carries no rate-limit decorator at all', async () => {
      const statuses = await fire(WRITE_LIMIT + 1, postCartItem);

      expect(statuses.slice(0, WRITE_LIMIT)).not.toContain(HttpStatus.TOO_MANY_REQUESTS);
      expect(statuses[WRITE_LIMIT]).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('counts a write before authenticating it, so a flood costs no token verification', async () => {
      // Under the limit this route answers 401: the throttler runs ahead of SessionAuthGuard.
      // Over it the 401 never happens, which is the only observable proof of that order.
      const statuses = await fire(WRITE_LIMIT + 1, postCartItem);

      expect(statuses[0]).toBe(HttpStatus.UNAUTHORIZED);
      expect(statuses[WRITE_LIMIT]).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('leaves reads out of it entirely', async () => {
      const statuses = await fire(WELL_PAST_EVERY_LIMIT, () =>
        request(app.getHttpServer()).get(HEALTH),
      );

      expect(new Set(statuses)).toEqual(new Set([HttpStatus.OK]));
    });

    it('rejects the request over the limit through the standard error contract', async () => {
      await fire(WRITE_LIMIT, postCartItem);
      const response = await postCartItem();
      const body = response.body as ErrorResponseBody;

      expect(response.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(body.statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(body.path).toBe(CART_ITEMS);
      expect(body.method).toBe('POST');
      expect(body.timestamp).toEqual(expect.any(String));
      expect(body.message).toBe('Too many requests. Please wait a moment and try again.');
    });

    it('names no bucket in the message, so a probe learns nothing about the defences', async () => {
      await fire(WRITE_LIMIT, postCartItem);
      const body = (await postCartItem()).body as ErrorResponseBody;

      expect(body.message).not.toContain('writes');
      expect(body.message).not.toContain('Throttler');
    });

    it('sends the standard Retry-After a client can act on', async () => {
      await fire(WRITE_LIMIT, postCartItem);
      const response = await postCartItem();

      // The library only sends Retry-After-writes, which no client looks for.
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('the auth-ip and auth-account buckets', () => {
    it('holds login to the tighter auth-ip limit rather than the write baseline', async () => {
      // AUTH_LIMIT < WRITE_LIMIT, so a 429 here can only have come from an auth bucket, and
      // AUTH_LIMIT < AUTH_ACCOUNT_LIMIT makes auth-ip specifically the one that bites first.
      const statuses = await fire(AUTH_LIMIT + 1, () => postLogin('shopper@example.com'));

      expect(statuses.slice(0, AUTH_LIMIT)).not.toContain(HttpStatus.TOO_MANY_REQUESTS);
      expect(statuses[AUTH_LIMIT]).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    // This is the case a single concatenated `ip|email` tracker cannot catch: one attacker
    // cycling through accounts from one address, each account seen for the first time.
    it('blocks one IP working through many accounts, the property auth-ip exists for', async () => {
      const statuses = await fireEach(AUTH_LIMIT + 1, (attempt) =>
        postLogin(`account-${attempt}@example.com`, DEFAULT_IP),
      );

      expect(statuses.slice(0, AUTH_LIMIT)).not.toContain(HttpStatus.TOO_MANY_REQUESTS);
      expect(statuses[AUTH_LIMIT]).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    // The other half of the same gap: a hundred IPs attacking one account each land under a
    // combined key's own ten-attempt allowance. Keying a bucket on the email alone closes it.
    it('blocks many IPs attacking a single account, the property auth-account exists for', async () => {
      const statuses = await fireEach(AUTH_ACCOUNT_LIMIT + 1, (attempt) =>
        postLogin('victim@example.com', `203.0.113.${attempt + 1}`),
      );

      expect(statuses.slice(0, AUTH_ACCOUNT_LIMIT)).not.toContain(HttpStatus.TOO_MANY_REQUESTS);
      expect(statuses[AUTH_ACCOUNT_LIMIT]).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('does not sweep a route with no email in its body into the account bucket', async () => {
      // Refresh carries no email. If a missing email fell back to one shared '' key, these
      // callers — each a distinct IP, each comfortably under its own auth-ip limit — would
      // throttle each other on the account bucket despite having nothing in common.
      const statuses = await fireEach(AUTH_ACCOUNT_LIMIT + 1, (attempt) =>
        postRefresh(`203.0.113.${100 + attempt}`),
      );

      expect(statuses).not.toContain(HttpStatus.TOO_MANY_REQUESTS);
    });
  });

  describe('the geocoding bucket', () => {
    it('caps the outbound search proxy, which is a read and so proves opt-in still reaches reads', async () => {
      const statuses = await fire(GEOCODING_LIMIT + 1, () =>
        request(app.getHttpServer()).get(GEO_SEARCH).query({ q: 'Dhanmondi' }),
      );

      expect(statuses.slice(0, GEOCODING_LIMIT)).not.toContain(HttpStatus.TOO_MANY_REQUESTS);
      expect(statuses[GEOCODING_LIMIT]).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('leaves the in-memory dataset routes on the same controller unthrottled', async () => {
      // These sat behind a class-level @SkipThrottle purely to escape the old opt-out
      // default. Dropping it must not have quietly enrolled them in the geocoding bucket.
      const statuses = await fire(WELL_PAST_EVERY_LIMIT, () =>
        request(app.getHttpServer()).get(GEO_DIVISIONS),
      );

      expect(new Set(statuses)).toEqual(new Set([HttpStatus.OK]));
    });
  });
});

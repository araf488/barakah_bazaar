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
 * AUTH is set *below* WRITE so the two can be told apart: login is a POST and therefore sits
 * in both buckets, and only the auth limit biting first proves which one is in charge.
 */
const AUTH_LIMIT = 3;
const WRITE_LIMIT = 4;
const GEOCODING_LIMIT = 2;

/**
 * Jest may run several spec files in one worker process, and `process.env` is shared across
 * them while the module registry is not. Limits this low would make any suite that follows
 * this one fail the moment it made a fifth write, so the previous values go back afterwards.
 */
const originalLimits = {
  AUTH_RATE_LIMIT: process.env.AUTH_RATE_LIMIT,
  WRITE_RATE_LIMIT: process.env.WRITE_RATE_LIMIT,
  GEOCODING_RATE_LIMIT: process.env.GEOCODING_RATE_LIMIT,
};

process.env.AUTH_RATE_LIMIT = String(AUTH_LIMIT);
process.env.WRITE_RATE_LIMIT = String(WRITE_LIMIT);
process.env.GEOCODING_RATE_LIMIT = String(GEOCODING_LIMIT);

const HEALTH = '/api/v1/health';
const CART_ITEMS = '/api/v1/cart/items';
const LOGIN = '/api/v1/auth/login';
const GEO_SEARCH = '/api/v1/geo/search';
const GEO_DIVISIONS = '/api/v1/geo/divisions';

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

  const postCartItem = () => request(app.getHttpServer()).post(CART_ITEMS).send(CART_BODY);

  const postLogin = (email: string) =>
    request(app.getHttpServer())
      .post(LOGIN)
      .set('x-device-id', 'rate-limit-device')
      .send({ email, password: REJECTED_PASSWORD });

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

  describe('the auth bucket', () => {
    it('holds login to the tighter auth limit rather than the write baseline', async () => {
      // AUTH_LIMIT < WRITE_LIMIT, so a 429 here can only have come from the auth bucket.
      const statuses = await fire(AUTH_LIMIT + 1, () => postLogin('shopper@example.com'));

      expect(statuses.slice(0, AUTH_LIMIT)).not.toContain(HttpStatus.TOO_MANY_REQUESTS);
      expect(statuses[AUTH_LIMIT]).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('counts per account, so guessing at one email cannot lock another out', async () => {
      await fire(AUTH_LIMIT + 1, () => postLogin('victim@example.com'));

      const other = await postLogin('bystander@example.com');

      expect(other.status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
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

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// `ConfigModule.forRoot()` reads the environment and validates it eagerly, at
// the moment app.module.ts is imported — not when the module is instantiated.
// So this configuration has to be in place at module scope, before that import
// happens, and AppModule has to be pulled in dynamically inside beforeAll.
// Setting these in beforeAll with a static import at the top would silently do
// nothing.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
// Never let the suite call a third-party geocoder.
process.env.GEOCODING_PROVIDER = 'noop';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Proves a fresh clone runs.
 *
 * No Supabase project, no database, no Redis: the app must still boot, serve
 * its probes, keep public routes public, keep protected routes protected, and
 * validate input. If this file fails, `git clone && npm install && npm start`
 * is broken for a new developer — which is the single most expensive kind of
 * breakage on a young project.
 */
describe('Degraded boot (no Supabase, no database)', () => {
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
  });

  describe('the app boots at all', () => {
    it('serves the liveness probe with 200', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.status).toBe(200);
    });

    it('reports itself degraded rather than pretending to be healthy', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.body.status).toBe('degraded');
      expect(response.body.checks.database).toBe('down');
    });

    it('reports the unconfigured third parties as disabled, not down', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.body.checks.storage).toBe('disabled');
      expect(response.body.checks.queue).toBe('disabled');
      // Every third-party capability defaults to noop, so a fresh clone reports all of them
      // deliberately off rather than broken.
      expect(response.body.checks.sms).toBe('disabled');
      expect(response.body.checks.email).toBe('disabled');
      expect(response.body.checks.payment).toBe('disabled');
    });

    it('reports authentication as down, not disabled, with no JWT_SECRET configured', async () => {
      // Unlike the third parties above, this is not a deliberately-off feature: the app still
      // boots and issues working sessions on a random per-boot secret, but every one of them
      // dies silently on the next restart. That is a real operational hazard, not a noop.
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.body.checks.authentication).toBe('down');
    });

    it('fails the readiness probe, so a deploy gate would hold', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health/ready');

      expect(response.status).toBe(503);
    });
  });

  describe('public routes stay public', () => {
    it('reaches the catalog without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/catalog/categories');

      // 503 from the *database*, not 401/503 from authentication — which is
      // what proves @Public() let the request past the global guard.
      expect(response.status).toBe(503);
      expect(response.body.message).toBe(
        'The service is temporarily unavailable. Please try again shortly.',
      );
    });

    it('serves the geography lookups without a token and without a database', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/geo/divisions');

      // 200, not 503: the dataset is vendored, so the address form works even with no
      // Supabase project and no Postgres.
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(8);
    });

    it('serves the Dhaka city thanas the address form needs', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/geo/districts/Dhaka/units');

      expect(response.status).toBe(200);
      const units = response.body as { nameEn: string }[];

      expect(units.map((unit) => unit.nameEn)).toEqual(
        expect.arrayContaining(['Gulshan', 'Motijheel', 'Savar']),
      );
    });

    it('reports map search as disabled rather than calling a third party', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/geo/search?q=gulshan');

      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Map search is not available right now.');
    });

    it('rejects a too-short map search before reaching any provider', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/geo/search?q=a');

      expect(response.status).toBe(400);
    });

    it('rejects an out-of-range coordinate', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/geo/reverse?lat=999&lng=0');

      expect(response.status).toBe(400);
    });

    it('resolves a pasted Google Maps link without any provider configured', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/geo/resolve-link')
        .send({ link: 'https://www.google.com/maps/@23.7925,90.4078,17z' });

      expect(response.status).toBe(200);
      expect(response.body.latitude).toBeCloseTo(23.7925, 3);
      // No geocoder in this suite, so there is no description — the paste still works.
      expect(response.body.label).toBeNull();
    });

    it('refuses a pasted link that points outside Google — SSRF guard', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/geo/resolve-link')
        .send({ link: 'http://169.254.169.254/latest/meta-data/' });

      expect(response.status).toBe(400);
    });

    it('answers 404 with the contract message for an unknown division', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/geo/divisions/Narnia/districts',
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Narnia is not a division of Bangladesh.');
    });
  });

  describe('protected routes stay protected', () => {
    const MISSING_TOKEN = 'Authentication is required to access this resource.';
    const INVALID_TOKEN = 'Your session is invalid or has expired. Please sign in again.';

    // 401, not 503: SessionAuthGuard's stage one — verifying the access token — runs on CPU
    // alone and needs neither Supabase nor a database, so "no credential presented" is a
    // definite answer even with every piece of infrastructure down. The point of each case is
    // that the request never reaches the service, and that it is not a 404, which would mean
    // the route was never registered at all.
    it.each([
      ['the current profile', '/api/v1/auth/me'],
      ['the address book', '/api/v1/users/me/addresses'],
      ['the admin audit trail', '/api/v1/admin/audit-log'],
      ['the staff user list', '/api/v1/admin/users'],
      ['warehouse stock', '/api/v1/admin/inventory'],
      ['the customer basket', '/api/v1/cart'],
      ['my orders', '/api/v1/orders'],
      ['the staff order queue', '/api/v1/admin/orders'],
    ])('refuses %s with no token', async (_label, path) => {
      const response = await request(app.getHttpServer()).get(path);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(MISSING_TOKEN);
    });

    it('refuses a profile update with no token', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .send({ fullName: 'Rahim Uddin' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(MISSING_TOKEN);
    });

    it('routes the default-promotion endpoint rather than 404ing it', async () => {
      const response = await request(app.getHttpServer()).put(
        '/api/v1/users/me/addresses/11111111-1111-1111-1111-111111111111/default',
      );

      // A 404 here would mean the route was never registered; 401 means it was registered
      // and the auth guard rejected the request first.
      expect(response.status).toBe(401);
    });

    it('refuses /auth/me with a bearer token it cannot verify', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer a.forged.token')
        .set('x-device-id', 'device-1');

      // Nothing was ever signed with this boot's random fallback JWT secret (JWT_SECRET is
      // unset in this suite), so a forged token fails verification the same way it would with
      // a real secret configured — still no database access required.
      expect(response.status).toBe(401);
      expect(response.body.message).toBe(INVALID_TOKEN);
    });
  });

  describe('the error contract', () => {
    it('rejects an invalid query parameter with 400 and field detail', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/catalog/products?page=0');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('The request contains invalid or missing fields.');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('rejects an unknown query parameter rather than ignoring it', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/catalog/products?definitelyNotAField=1',
      );

      expect(response.status).toBe(400);
    });

    it('answers 404 for an unknown route in the standard error shape', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist');

      expect(response.status).toBe(404);
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 404,
          path: '/api/v1/does-not-exist',
          method: 'GET',
        }),
      );
    });

    it('stamps every response with a correlation id', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('echoes a caller-supplied correlation id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .set('x-request-id', 'trace-me-123');

      expect(response.body.requestId).toBe('trace-me-123');
    });
  });
});

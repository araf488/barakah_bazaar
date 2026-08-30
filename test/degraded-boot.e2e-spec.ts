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
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_JWKS_URL;
delete process.env.SUPABASE_JWT_SECRET;
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

    it('reports the unconfigured dependencies as disabled, not down', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      expect(response.body.checks.authentication).toBe('disabled');
      expect(response.body.checks.storage).toBe('disabled');
      expect(response.body.checks.queue).toBe('disabled');
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

    it('answers 404 with the contract message for an unknown division', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/geo/divisions/Narnia/districts',
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Narnia is not a division of Bangladesh.');
    });
  });

  describe('protected routes stay protected', () => {
    it('refuses /auth/me with no token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/auth/me');

      expect(response.status).toBe(503);
      expect(response.body.message).toBe(
        'Authentication is temporarily unavailable. Please try again later.',
      );
    });

    it('refuses /auth/me with a bearer token it cannot verify', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer a.forged.token');

      expect(response.status).toBe(503);
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

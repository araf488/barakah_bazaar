import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '../src/infra/prisma/prisma-client';
import {
  DATABASE_UNREACHABLE_MESSAGE,
  DatabaseSuiteLock,
  SEED_SCRYPT_PARAMETERS,
  TEST_DATABASE_URL,
  acquireDatabaseSuiteLock,
  applyMigrations,
  authHeaders,
  isTestDatabaseReachable,
  loginAs,
  resetDatabase,
  seedVerifiedUser,
  testPrisma,
} from './support/auth-fixtures';

// Same module-scope environment as the other e2e suites: ConfigModule validates it when
// app.module.ts is imported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-bkash-routes-suite-signing-secret-32c';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);
process.env.SESSION_CACHE_ENABLED = 'false';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.AUTH_ACCOUNT_RATE_LIMIT = '1000';
process.env.WRITE_RATE_LIMIT = '1000';
// The storefront the callback redirects to, pinned so an exported value cannot change the Location.
process.env.APP_PUBLIC_BASE_URL = 'http://localhost:3000';

const DEVICE = 'device-e2e-1';
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'bkash-routes@barakahbazaar.com.bd';
const RESULT = 'http://localhost:3000/checkout/payment-result';
const STRANGER_ORDER = '7f2c1f0e-3f6a-4b2e-9d5a-0c1f6d1a2b3c';

/**
 * The two bKash routes through the real pipeline: that they are mounted where the spec says,
 * that the callback needs no token, and that the start route does. Settling is covered by the
 * service and ledger suites.
 */
describe('bKash routes (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let suiteLock: DatabaseSuiteLock | undefined;

  beforeAll(async () => {
    if (!(await isTestDatabaseReachable())) {
      throw new Error(DATABASE_UNREACHABLE_MESSAGE);
    }

    suiteLock = await acquireDatabaseSuiteLock();
    applyMigrations();
    prisma = testPrisma();

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await app.listen(0);
  }, 120_000);

  afterAll(async () => {
    try {
      await app?.close();
      await prisma?.$disconnect();
    } finally {
      await suiteLock?.release();
    }
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('GET /payments/bkash/callback', () => {
    it('redirects 302 to the storefront as failed, with no token, for an unknown paymentID', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/payments/bkash/callback')
        .query({ paymentID: 'PAYID-UNKNOWN', status: 'success' });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(`${RESULT}?outcome=failed`);
    });

    it('redirects 302 as failed, not 400, when paymentID is missing', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/payments/bkash/callback');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(`${RESULT}?outcome=failed`);
    });

    it('redirects 302 as failed, not 400, for a paymentID over 64 characters', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/payments/bkash/callback')
        .query({ paymentID: 'P'.repeat(65) });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(`${RESULT}?outcome=failed`);
    });
  });

  describe('POST /orders/:id/payments/bkash', () => {
    it('answers 401 without a token', async () => {
      const response = await request(app.getHttpServer()).post(
        `/api/v1/orders/${STRANGER_ORDER}/payments/bkash`,
      );

      expect(response.status).toBe(401);
    });

    it('answers 400 for an order id that is not a uuid', async () => {
      await seedVerifiedUser(prisma, { email: EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders/not-a-uuid/payments/bkash')
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(response.status).toBe(400);
    });

    it("answers 404 with the order not-found message for an order that is not the caller's", async () => {
      await seedVerifiedUser(prisma, { email: EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/orders/${STRANGER_ORDER}/payments/bkash`)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Order not found.');
    });
  });
});

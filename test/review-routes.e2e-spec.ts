import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  OrderStatus,
  PrismaClient,
  ProductVariant,
  ReviewStatus,
} from '../src/infra/prisma/prisma-client';
import {
  DATABASE_UNREACHABLE_MESSAGE,
  DatabaseSuiteLock,
  SEED_SCRYPT_PARAMETERS,
  TEST_DATABASE_URL,
  TokenPair,
  acquireDatabaseSuiteLock,
  applyMigrations,
  authHeaders,
  isTestDatabaseReachable,
  loginAs,
  resetDatabase,
  seedVerifiedUser,
  testPrisma,
} from './support/auth-fixtures';
import { clearStore, placeBkashOrder, seedStore } from './support/order-fixtures';

// Same module-scope environment as the other e2e suites: ConfigModule validates it when
// app.module.ts is imported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-review-routes-suite-signing-secret-32';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);
process.env.SESSION_CACHE_ENABLED = 'false';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.AUTH_ACCOUNT_RATE_LIMIT = '1000';
process.env.WRITE_RATE_LIMIT = '1000';
process.env.APP_PUBLIC_BASE_URL = 'http://localhost:3000';

const DEVICE = 'device-e2e-reviews';
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'review-routes@barakahbazaar.com.bd';

/**
 * The review routes through the real pipeline: that a guest can read published reviews, that
 * the caller's own list needs a session, and that a delivered line moves from "awaiting" to a
 * pending review that stays off the product page until it is published.
 */
describe('Review routes (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let suiteLock: DatabaseSuiteLock | undefined;
  let variant: ProductVariant;

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
      if (prisma) {
        await resetDatabase(prisma);
        await clearStore(prisma);
      }
      await app?.close();
      await prisma?.$disconnect();
    } finally {
      await suiteLock?.release();
    }
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await clearStore(prisma);
    ({ variant } = await seedStore(prisma));
  });

  /** A signed-in customer with one delivered order for the seeded variant. */
  const deliveredCustomer = async (): Promise<{ tokens: TokenPair; orderItemId: string }> => {
    await seedVerifiedUser(prisma, { email: EMAIL, password: PASSWORD });
    const tokens = await loginAs(app, EMAIL, PASSWORD, DEVICE);
    const order = await placeBkashOrder(
      app,
      { accessToken: tokens.accessToken, deviceId: DEVICE },
      variant.id,
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DELIVERED, deliveredAt: new Date() },
    });
    return { tokens, orderItemId: order.items[0].id };
  };

  describe('GET /reviews/product/:productId', () => {
    it('answers a guest with no token, listing published reviews only', async () => {
      const { tokens, orderItemId } = await deliveredCustomer();
      const created = await request(app.getHttpServer())
        .post('/api/v1/reviews')
        .set(authHeaders(tokens.accessToken, DEVICE))
        .send({ orderItemId, rating: 5, body: 'Fresh and well packed.' });
      expect(created.status).toBe(201);

      const pending = await request(app.getHttpServer()).get(
        `/api/v1/reviews/product/${variant.productId}`,
      );
      expect(pending.status).toBe(200);
      expect(pending.body).toMatchObject({ items: [], total: 0 });

      // Published straight in the database: moderation needs a staff session with MFA, and its
      // own suites cover it. The check constraint wants an actor; any user row satisfies it.
      const actor = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      await prisma.review.update({
        where: { id: created.body.id },
        data: { status: ReviewStatus.PUBLISHED, moderatedBy: actor.id, moderatedAt: new Date() },
      });

      const published = await request(app.getHttpServer()).get(
        `/api/v1/reviews/product/${variant.productId}`,
      );
      expect(published.status).toBe(200);
      expect(published.body.total).toBe(1);
      expect(published.body.items[0]).toMatchObject({
        rating: 5,
        body: 'Fresh and well packed.',
        isVerifiedPurchase: true,
      });
      expect(published.body.items[0]).not.toHaveProperty('userId');
    });
  });

  describe('GET /reviews/mine', () => {
    it('answers 401 without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/reviews/mine');

      expect(response.status).toBe(401);
    });

    it('moves a delivered line from awaiting to a pending review once it is written', async () => {
      const { tokens, orderItemId } = await deliveredCustomer();
      const headers = authHeaders(tokens.accessToken, DEVICE);

      const before = await request(app.getHttpServer()).get('/api/v1/reviews/mine').set(headers);
      expect(before.status).toBe(200);
      expect(before.body.reviews).toEqual([]);
      expect(before.body.awaiting).toEqual([
        expect.objectContaining({
          orderItemId,
          productId: variant.productId,
          productSlug: 'e2e-bkash-product',
          productNameBn: 'বিকাশ পণ্য',
          variantNameEn: '1 kg',
        }),
      ]);

      await request(app.getHttpServer())
        .post('/api/v1/reviews')
        .set(headers)
        .send({ orderItemId, rating: 4, title: 'Good' })
        .expect(201);

      const after = await request(app.getHttpServer()).get('/api/v1/reviews/mine').set(headers);
      expect(after.body.awaiting).toEqual([]);
      expect(after.body.reviews).toEqual([
        expect.objectContaining({
          rating: 4,
          title: 'Good',
          status: ReviewStatus.PENDING,
          productSlug: 'e2e-bkash-product',
        }),
      ]);
      expect(after.body.reviews[0]).not.toHaveProperty('moderationNote');
    });
  });
});

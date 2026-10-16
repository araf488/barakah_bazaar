import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '../src/infra/prisma/prisma-client';
import { AuthTokens } from '../src/modules/auth/auth.constants';
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
import { RecordingSmsGateway } from './support/sms-fixtures';

// ConfigModule.forRoot() reads the environment when app.module.ts is imported, so everything
// is set at module scope, before the dynamic import inside beforeAll.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-phone-limits-suite-signing-secret-32c';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);
process.env.SESSION_CACHE_ENABLED = 'false';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.AUTH_ACCOUNT_RATE_LIMIT = '1000';
process.env.WRITE_RATE_LIMIT = '1000';

/** The whole-app daily SMS ceiling, set low so a handful of sends reach it. */
const SMS_DAILY_LIMIT = 3;

/**
 * Jest may run several spec files in one worker process and `process.env` is shared, so the
 * values this suite overrides go back afterwards.
 */
const originalLimits = {
  SMS_DAILY_LIMIT: process.env.SMS_DAILY_LIMIT,
  AUTH_PHONE_RATE_LIMIT: process.env.AUTH_PHONE_RATE_LIMIT,
};

process.env.SMS_DAILY_LIMIT = String(SMS_DAILY_LIMIT);
process.env.AUTH_PHONE_RATE_LIMIT = '100';

const DEVICE = 'device-e2e-1';
const PASSWORD = 'correct horse battery staple';
const PHONE_VERIFICATION = '/api/v1/auth/phone/verification';
const PHONE_LOGIN = '/api/v1/auth/phone/login';
const SMS_UNAVAILABLE = 'Text messages are unavailable right now. Please try again later.';

/** Four customers and four distinct numbers: one more than the daily ceiling allows. */
const CUSTOMERS = [
  { email: 'one@barakahbazaar.com.bd', phone: '01711111111' },
  { email: 'two@barakahbazaar.com.bd', phone: '01722222222' },
  { email: 'three@barakahbazaar.com.bd', phone: '01733333333' },
  { email: 'four@barakahbazaar.com.bd', phone: '01744444444' },
];
const UNKNOWN_PHONE = '+8801555555555';

/**
 * The daily SMS ceiling against real Postgres: the count runs in SQL across both code tables,
 * so a mock cannot say whether the fourth send is refused.
 */
describe('Phone SMS daily limit (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let suiteLock: DatabaseSuiteLock | undefined;
  const smsGateway = new RecordingSmsGateway();

  beforeAll(async () => {
    if (!(await isTestDatabaseReachable())) {
      throw new Error(DATABASE_UNREACHABLE_MESSAGE);
    }

    suiteLock = await acquireDatabaseSuiteLock();
    applyMigrations();
    prisma = testPrisma();

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthTokens.SmsGateway)
      .useValue(smsGateway)
      .compile();

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
      process.env.SMS_DAILY_LIMIT = originalLimits.SMS_DAILY_LIMIT;
      process.env.AUTH_PHONE_RATE_LIMIT = originalLimits.AUTH_PHONE_RATE_LIMIT;
      if (originalLimits.SMS_DAILY_LIMIT === undefined) delete process.env.SMS_DAILY_LIMIT;
      if (originalLimits.AUTH_PHONE_RATE_LIMIT === undefined) {
        delete process.env.AUTH_PHONE_RATE_LIMIT;
      }
      await app?.close();
      await prisma?.$disconnect();
    } finally {
      await suiteLock?.release();
    }
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    smsGateway.reset();
  });

  it('answers 503 on verification, and on sign-in for an unknown number, once the day is spent', async () => {
    const sessions: Record<string, string>[] = [];
    for (const customer of CUSTOMERS) {
      await seedVerifiedUser(prisma, { email: customer.email, password: PASSWORD });
      const tokens = await loginAs(app, customer.email, PASSWORD, DEVICE);
      sessions.push(authHeaders(tokens.accessToken, DEVICE));
    }

    for (let sent = 0; sent < SMS_DAILY_LIMIT; sent += 1) {
      const accepted = await request(app.getHttpServer())
        .post(PHONE_VERIFICATION)
        .set(sessions[sent])
        .send({ phone: CUSTOMERS[sent].phone });
      expect(accepted.status).toBe(202);
    }

    const refused = await request(app.getHttpServer())
      .post(PHONE_VERIFICATION)
      .set(sessions[SMS_DAILY_LIMIT])
      .send({ phone: CUSTOMERS[SMS_DAILY_LIMIT].phone });
    expect(refused.status).toBe(503);
    expect(refused.body.message).toBe(SMS_UNAVAILABLE);

    const unknownLogin = await request(app.getHttpServer())
      .post(PHONE_LOGIN)
      .send({ phone: UNKNOWN_PHONE });
    expect(unknownLogin.status).toBe(503);
    expect(unknownLogin.body.message).toBe(SMS_UNAVAILABLE);
  });
});

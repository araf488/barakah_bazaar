import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, UserRole } from '../src/infra/prisma/prisma-client';
import { AuthConstants } from '../src/modules/auth/auth.constants';
import { SecretCipher } from '../src/modules/auth/crypto/secret-cipher';
import { AccessTokenService } from '../src/modules/auth/tokens/access-token.service';
import { TotpService } from '../src/modules/auth/crypto/totp.service';
import {
  DATABASE_UNREACHABLE_MESSAGE,
  SEED_SCRYPT_PARAMETERS,
  TEST_DATABASE_URL,
  applyMigrations,
  authHeaders,
  isTestDatabaseReachable,
  loginAs,
  resetDatabase,
  seedVerifiedUser,
  testPrisma,
} from './support/auth-fixtures';

// ConfigModule.forRoot() reads and validates the environment when app.module.ts is imported,
// not when the module is instantiated — so every value has to be set at module scope, before
// the dynamic import inside beforeAll. See degraded-boot.e2e-spec.ts.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
// The one suite that talks to a real database, and only ever the throwaway one.
process.env.DATABASE_URL = TEST_DATABASE_URL;
// Fixed rather than random, so a token still verifies after anything re-reads the config.
process.env.JWT_SECRET = 'e2e-identity-suite-signing-secret-32ch';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
// Matches the seed fixture, so no login triggers a rehash write mid-test.
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);
// Zero, so a settings row this suite writes is read back on the very next request rather
// than a minute later.
process.env.AUTH_SETTINGS_CACHE_SECONDS = '0';
// Off: revocation through the database is what this suite exists to prove. The cache has its
// own unit coverage, and leaving it on here would hide a stale-read bug behind a cache miss.
process.env.SESSION_CACHE_ENABLED = 'false';
// This suite signs in repeatedly. Without these it would measure the throttler instead.
process.env.AUTH_RATE_LIMIT = '1000';
process.env.AUTH_ACCOUNT_RATE_LIMIT = '1000';
process.env.WRITE_RATE_LIMIT = '1000';

const DEVICE = 'device-e2e-1';
const OTHER_DEVICE = 'device-e2e-2';
const PASSWORD = 'correct horse battery staple';
const CUSTOMER_EMAIL = 'shopper@barakahbazaar.com.bd';
const STAFF_EMAIL = 'ops@barakahbazaar.com.bd';

const ME = '/api/v1/auth/me';
const LOGIN = '/api/v1/auth/login';
const LOGIN_MFA = '/api/v1/auth/login/mfa';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const SESSIONS = '/api/v1/auth/sessions';
const ADMIN_USERS = '/api/v1/admin/users';

const INVALID_TOKEN = 'Your session is invalid or has expired. Please sign in again.';
const INVALID_CREDENTIALS = 'Those sign-in details are not correct.';

/**
 * The whole identity journey against a real Postgres.
 *
 * Everything here depends on rows and indexes a mock cannot stand in for: an account disabled
 * mid-session, a refresh token rotated out from under a second tab, a session deleted from
 * another device. A repository double would pass whatever the guard did, which is precisely
 * why these tests were not written at the unit level.
 *
 * Requires the `postgres-test` container — `docker compose up -d postgres-test`. It fails
 * loudly rather than skipping when the database is missing: a suite that quietly passes
 * without its dependency verifies nothing at all.
 */
describe('Identity (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  /** Writes the singleton settings row, so a test can change one rule and re-read it. */
  const writeSettings = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    const data = {
      accessTokenMinutes: 30,
      customerRefreshIdleMinutes: 43_200,
      customerRefreshAbsoluteMinutes: 129_600,
      staffRefreshIdleMinutes: 720,
      staffRefreshAbsoluteMinutes: 10_080,
      // Off by default here so a staff login yields a session rather than an enrolment demand;
      // the one test that cares about the demand turns it back on.
      staffMfaRequired: false,
      emailVerificationGraceHours: 168,
      refreshReuseGraceSeconds: 30,
      ...overrides,
    };

    await prisma.authSettings.upsert({
      where: { id: AuthConstants.AuthSettingsRowId },
      create: { id: AuthConstants.AuthSettingsRowId, ...data },
      update: data,
    });
  };

  beforeAll(async () => {
    if (!(await isTestDatabaseReachable())) {
      throw new Error(DATABASE_UNREACHABLE_MESSAGE);
    }

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
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await writeSettings();
  });

  describe('signing in', () => {
    it('registers no one — a seeded user signs in and receives a token pair', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: CUSTOMER_EMAIL, password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.kind).toBe('session');
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.portal).toBe('STOREFRONT');
    });

    it('stores no raw refresh token, only its hash', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const rows = await prisma.session.findMany();

      expect(rows).toHaveLength(1);
      expect(rows[0].refreshTokenHash).not.toBe(tokens.refreshToken);
      expect(JSON.stringify(rows[0])).not.toContain(tokens.refreshToken);
    });

    it('an authenticated call succeeds with the access token', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(response.status).toBe(200);
      expect(response.body.email).toBe(CUSTOMER_EMAIL);
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('answers the same 401 for a wrong password and an address with no account', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      const wrongPassword = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: CUSTOMER_EMAIL, password: 'not the password' });

      const unknownAddress = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: 'nobody@barakahbazaar.com.bd', password: PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(wrongPassword.body.message).toBe(INVALID_CREDENTIALS);
      expect(unknownAddress.status).toBe(401);
      expect(unknownAddress.body.message).toBe(INVALID_CREDENTIALS);
    });

    it('refuses a login with no X-Device-Id, before any password is checked', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .send({ email: CUSTOMER_EMAIL, password: PASSWORD });

      expect(response.status).toBe(400);
      expect(await prisma.session.count()).toBe(0);
    });

    it('rejects a malformed payload with 400 and field detail', async () => {
      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });
  });

  describe('refresh', () => {
    it('returns a new pair, and the old refresh token stops working', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const first = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const rotated = await request(app.getHttpServer())
        .post(REFRESH)
        .set('x-device-id', DEVICE)
        .send({ refreshToken: first.refreshToken });

      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

      // Past the grace window the old token is a replay — proved by its own test below. Here
      // the point is only that the new one is the live credential.
      const withNew = await request(app.getHttpServer())
        .post(REFRESH)
        .set('x-device-id', DEVICE)
        .send({ refreshToken: rotated.body.refreshToken });

      expect(withNew.status).toBe(200);
    });

    it('five concurrent refreshes all succeed and the session survives', async () => {
      // The grace window exists for exactly this: a client with several tabs presents the
      // same token more than once, and a naive rotate-or-revoke reads the second as theft.
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app.getHttpServer())
            .post(REFRESH)
            .set('x-device-id', DEVICE)
            .send({ refreshToken: tokens.refreshToken }),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);

      const session = await prisma.session.findFirstOrThrow();
      expect(session.revokedAt).toBeNull();
    });

    it('replaying a refresh token after the grace has passed revokes the session', async () => {
      // The grace is set to zero rather than advancing a clock: the app reads it from
      // auth_settings on every request, so this exercises the real deadline arithmetic with
      // no fake timers to disagree with the database's own now().
      await writeSettings({ refreshReuseGraceSeconds: 0 });
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const first = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      await request(app.getHttpServer())
        .post(REFRESH)
        .set('x-device-id', DEVICE)
        .send({ refreshToken: first.refreshToken });

      const replay = await request(app.getHttpServer())
        .post(REFRESH)
        .set('x-device-id', DEVICE)
        .send({ refreshToken: first.refreshToken });

      expect(replay.status).toBe(401);

      const session = await prisma.session.findFirstOrThrow();
      expect(session.revokedAt).not.toBeNull();
    });

    it('refuses a refresh token that was never issued', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .post(REFRESH)
        .set('x-device-id', DEVICE)
        .send({ refreshToken: 'never-issued-by-anyone' });

      expect(response.status).toBe(401);
    });
  });

  describe('ending a session', () => {
    it('logout kills both tokens', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const loggedOut = await request(app.getHttpServer())
        .post(LOGOUT)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(loggedOut.status).toBe(204);

      const withAccess = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, DEVICE));
      const withRefresh = await request(app.getHttpServer())
        .post(REFRESH)
        .set('x-device-id', DEVICE)
        .send({ refreshToken: tokens.refreshToken });

      expect(withAccess.status).toBe(401);
      expect(withRefresh.status).toBe(401);
    });

    it('a session listed via GET /auth/sessions and then deleted stops working', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const here = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const elsewhere = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE);

      const listing = await request(app.getHttpServer())
        .get(SESSIONS)
        .set(authHeaders(here.accessToken, DEVICE));

      expect(listing.status).toBe(200);
      expect(listing.body).toHaveLength(2);

      const other = (listing.body as { id: string; deviceId: string; current: boolean }[]).find(
        (row) => row.deviceId === OTHER_DEVICE,
      );

      expect(other?.current).toBe(false);

      const deleted = await request(app.getHttpServer())
        .delete(`${SESSIONS}/${other?.id}`)
        .set(authHeaders(here.accessToken, DEVICE));

      expect(deleted.status).toBe(204);

      const stillHere = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(here.accessToken, DEVICE));
      const gone = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(elsewhere.accessToken, OTHER_DEVICE));

      expect(stillHere.status).toBe(200);
      expect(gone.status).toBe(401);
    });

    it('returns no token material of any kind in the listing', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const listing = await request(app.getHttpServer())
        .get(SESSIONS)
        .set(authHeaders(tokens.accessToken, DEVICE));

      const serialised = JSON.stringify(listing.body);
      const row = await prisma.session.findFirstOrThrow();

      expect(serialised).not.toContain(row.refreshTokenHash);
      expect(serialised).not.toContain(tokens.refreshToken);
      expect(serialised).not.toContain('refreshTokenHash');
    });

    it('deleting someone else session answers 404, so ids cannot be probed', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const victim = await seedVerifiedUser(prisma, {
        email: 'someone.else@barakahbazaar.com.bd',
        password: PASSWORD,
      });
      const mine = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const theirs = await loginAs(
        app,
        'someone.else@barakahbazaar.com.bd',
        PASSWORD,
        OTHER_DEVICE,
      );

      const theirSession = await prisma.session.findFirstOrThrow({ where: { userId: victim.id } });

      const response = await request(app.getHttpServer())
        .delete(`${SESSIONS}/${theirSession.id}`)
        .set(authHeaders(mine.accessToken, DEVICE));

      expect(response.status).toBe(404);

      // And it really was not revoked: a 404 that quietly worked would be worse than a 403.
      const stillLive = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(theirs.accessToken, OTHER_DEVICE));

      expect(stillLive.status).toBe(200);
    });

    it('logout-all ends every session including the one that asked', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const here = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const elsewhere = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set(authHeaders(here.accessToken, DEVICE));

      expect(response.status).toBe(200);
      expect(response.body.revoked).toBe(2);

      const first = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(here.accessToken, DEVICE));
      const second = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(elsewhere.accessToken, OTHER_DEVICE));

      expect(first.status).toBe(401);
      expect(second.status).toBe(401);
    });
  });

  describe('device binding', () => {
    it('the same access token replayed with a different X-Device-Id is rejected', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, OTHER_DEVICE));

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(INVALID_TOKEN);
    });

    it('ends the session when a valid token arrives from another device', async () => {
      // §5.6, through the whole pipeline: verification accepts the signature and then finds
      // the wrong device, so the session is revoked rather than merely refused. A token
      // separated from its device id is one that leaked, and this is what turns a silent
      // compromise into a logout its owner can see.
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const replayed = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, OTHER_DEVICE));

      expect(replayed.status).toBe(401);

      const session = await prisma.session.findFirstOrThrow();
      expect(session.revokedAt).not.toBeNull();

      // And the real device is signed out too — the point of the control, and its cost.
      const owner = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(owner.status).toBe(401);
    });

    it('records the revocation for a staff account, with its reason', async () => {
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });
      const tokens = await loginAs(app, STAFF_EMAIL, PASSWORD, DEVICE);

      await request(app.getHttpServer()).get(ME).set(authHeaders(tokens.accessToken, OTHER_DEVICE));

      const rows = await prisma.adminAuditLog.findMany({
        where: { action: 'auth.session_revoked' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].after).toMatchObject({ reason: 'device_mismatch' });
    });

    it('writes one audit row however many times the leaked token is replayed', async () => {
      // Otherwise whoever holds the token can flood the audit log by looping.
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });
      const tokens = await loginAs(app, STAFF_EMAIL, PASSWORD, DEVICE);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await request(app.getHttpServer())
          .get(ME)
          .set(authHeaders(tokens.accessToken, OTHER_DEVICE));
      }

      const rows = await prisma.adminAuditLog.findMany({
        where: { action: 'auth.session_revoked' },
      });

      expect(rows).toHaveLength(1);
    });

    it('refuses a request with no X-Device-Id at all', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .get(ME)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(response.status).toBe(401);
      // No device id means nothing was compared, so nothing is revoked: a client that
      // forgets the header must not sign its user out.
      expect((await prisma.session.findFirstOrThrow()).revokedAt).toBeNull();
    });

    it('survives an IP change, because there is no IP binding', async () => {
      // Built, reviewed and deleted: behind a proxy the check was inert, and on a mobile
      // network it signed real users out. This pins that decision.
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, DEVICE))
        .set('X-Forwarded-For', '198.51.100.77');

      expect(response.status).toBe(200);
    });

    it('revokes nothing for a token this API did not sign, even when it names a real session', async () => {
      // The attack the design has to withstand: if a caller could name any session id and
      // have it revoked, this control would be a way to sign other people out. It cannot,
      // because the binding check runs only after the signature has been accepted — so a
      // token signed with the wrong key never reaches the branch that names a session.
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const live = await prisma.session.findFirstOrThrow();

      const attacker = new AccessTokenService(
        {
          get: (key: string) =>
            ({
              JWT_SECRET: 'a-different-secret-that-is-not-ours-32',
              JWT_ISSUER: 'barakah-bazaar-api',
              JWT_AUDIENCE: 'barakah-bazaar',
            })[key],
        } as never,
        { debug: () => undefined, error: () => undefined, warn: () => undefined } as never,
      );

      const forged = await attacker.sign(
        {
          userId: 'whoever',
          // A REAL session id, which is the whole point of the test.
          sessionId: live.id,
          role: UserRole.CUSTOMER,
          email: CUSTOMER_EMAIL,
          deviceId: OTHER_DEVICE,
        },
        30,
      );

      const response = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(forged, OTHER_DEVICE));

      expect(response.status).toBe(401);
      expect((await prisma.session.findFirstOrThrow()).revokedAt).toBeNull();

      const stillWorks = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(stillWorks.status).toBe(200);
    });
  });

  describe('the row is the authority', () => {
    it('an account disabled mid-session is rejected on the very next request', async () => {
      const user = await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const before = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(before.status).toBe(200);

      // No re-login, no token change: only the column.
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      const after = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(after.status).toBe(403);
      expect(after.body.message).toBe('This account has been disabled. Please contact support.');
    });

    it('a role changed mid-session applies on the next request, from the row not the token', async () => {
      const user = await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.SUPER_ADMIN,
      });
      const tokens = await loginAs(app, STAFF_EMAIL, PASSWORD, DEVICE);

      const before = await request(app.getHttpServer())
        .get(ADMIN_USERS)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(before.status).toBe(200);

      await prisma.user.update({ where: { id: user.id }, data: { role: UserRole.CUSTOMER } });

      const after = await request(app.getHttpServer())
        .get(ADMIN_USERS)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(after.status).toBe(403);
    });

    it('an auth_settings edit changes the next login token lifetime', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      const thirtyMinutes = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      await writeSettings({ accessTokenMinutes: 5 });

      const fiveMinutes = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE);

      const longer = new Date(thirtyMinutes.expiresAt).getTime();
      const shorter = new Date(fiveMinutes.expiresAt).getTime();

      // Roughly 25 minutes apart, allowing for the seconds between the two logins.
      expect(longer - shorter).toBeGreaterThan(24 * 60 * 1000);
    });
  });

  describe('roles and portals', () => {
    it.each([
      [UserRole.CUSTOMER, 'STOREFRONT'],
      [UserRole.SUPPORT, 'ADMIN'],
      [UserRole.OPS, 'ADMIN'],
      [UserRole.SUPER_ADMIN, 'ADMIN'],
    ])('%s signs in to %s', async (role, portal) => {
      const email = `${String(role).toLowerCase()}@barakahbazaar.com.bd`;
      await seedVerifiedUser(prisma, { email, password: PASSWORD, role });

      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email, password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.portal).toBe(portal);
    });

    it('@Roles is enforced through the real pipeline: a customer cannot read the staff list', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .get(ADMIN_USERS)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('You do not have permission to perform this action.');
    });

    it('answers 401, not 403, when no token is presented at all', async () => {
      const response = await request(app.getHttpServer()).get(ADMIN_USERS);

      expect(response.status).toBe(401);
    });
  });

  describe('the second factor', () => {
    /** Enrols TOTP the way the service does, so login sees a genuinely enrolled account. */
    const enrolTotp = async (userId: string): Promise<string> => {
      const totp = new TotpService();
      const cipher = new SecretCipher({
        get: () => process.env.TOTP_ENCRYPTION_KEY,
      } as never);
      const secret = totp.generateSecret();

      await prisma.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: cipher.encrypt(secret), totpEnabledAt: new Date() },
      });

      return secret;
    };

    it('a staff account with TOTP enrolled can no longer sign in with a password alone', async () => {
      const user = await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });
      await enrolTotp(user.id);

      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.kind).toBe('mfa');
      expect(response.body.accessToken).toBeUndefined();
      expect(await prisma.session.count()).toBe(0);
    });

    it('completes the sign-in with a correct code, and refuses a wrong one', async () => {
      const user = await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });
      const secret = await enrolTotp(user.id);

      const started = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: PASSWORD });

      const wrong = await request(app.getHttpServer())
        .post(LOGIN_MFA)
        .set('x-device-id', DEVICE)
        .send({ mfaToken: started.body.mfaToken, code: '000000' });

      expect(wrong.status).toBe(401);
      expect(await prisma.session.count()).toBe(0);

      const right = await request(app.getHttpServer())
        .post(LOGIN_MFA)
        .set('x-device-id', DEVICE)
        .send({ mfaToken: started.body.mfaToken, code: new TotpService().codeFor(secret) });

      expect(right.status).toBe(200);
      expect(right.body.accessToken).toEqual(expect.any(String));
      expect(await prisma.session.count()).toBe(1);
    });

    it('demands enrolment from a staff account with no second factor when the rule is on', async () => {
      await writeSettings({ staffMfaRequired: true });
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });

      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: PASSWORD });

      expect(response.body.kind).toBe('enrolment');
      expect(await prisma.session.count()).toBe(0);
    });

    it('leaves a customer alone when staff MFA is required', async () => {
      await writeSettings({ staffMfaRequired: true });
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: CUSTOMER_EMAIL, password: PASSWORD });

      expect(response.body.kind).toBe('session');
    });
  });

  describe('every route refuses what it should', () => {
    const MISSING_TOKEN = 'Authentication is required to access this resource.';

    it.each([
      ['GET', ME],
      ['GET', SESSIONS],
      ['POST', LOGOUT],
      ['POST', '/api/v1/auth/logout-all'],
      ['DELETE', `${SESSIONS}/11111111-1111-1111-1111-111111111111`],
    ])('%s %s answers 401 with no token', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'post' | 'delete'](path)
        .set('x-device-id', DEVICE);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(MISSING_TOKEN);
    });

    it('rejects a session id that is not a uuid before reaching the service', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .delete(`${SESSIONS}/not-a-uuid`)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(response.status).toBe(400);
      // The caller's own session is untouched: the pipe refused before anything ran.
      expect((await prisma.session.findFirstOrThrow()).revokedAt).toBeNull();
    });

    it('answers 404 for a session id that is well-formed but does not exist', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const tokens = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .delete(`${SESSIONS}/11111111-1111-1111-1111-111111111111`)
        .set(authHeaders(tokens.accessToken, DEVICE));

      expect(response.status).toBe(404);
    });

    it('refuses a login with an unknown field rather than ignoring it', async () => {
      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: CUSTOMER_EMAIL, password: PASSWORD, role: 'SUPER_ADMIN' });

      expect(response.status).toBe(400);
    });

    it('names the device-id requirement exactly, on login and on refresh', async () => {
      const login = await request(app.getHttpServer())
        .post(LOGIN)
        .send({ email: CUSTOMER_EMAIL, password: PASSWORD });
      const refresh = await request(app.getHttpServer())
        .post(REFRESH)
        .send({ refreshToken: 'anything' });

      expect(login.body.message).toBe('This client must identify its device.');
      expect(refresh.body.message).toBe('This client must identify its device.');
    });

    it('refuses an mfa exchange that carries both a code and a recovery code', async () => {
      const response = await request(app.getHttpServer())
        .post(LOGIN_MFA)
        .set('x-device-id', DEVICE)
        .send({ mfaToken: 'token', code: '123456', recoveryCode: 'abcdef123456' });

      expect(response.status).toBe(400);
    });
  });

  describe('what the database enforces', () => {
    it('has no policy left that keys on the dropped Supabase column', async () => {
      // §8.6: the owner-scoped policies compared users.supabase_user_id to auth.uid(). Both
      // halves are gone. A policy still referencing that column would not merely be dead —
      // it would have made the contract migration's DROP COLUMN fail, so this also proves
      // that migration applied against a real Postgres rather than only being reasoned about.
      const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::bigint AS count FROM pg_policies
         WHERE qual::text LIKE '%supabase_user_id%'
            OR with_check::text LIKE '%supabase_user_id%'`,
      );

      expect(Number(rows[0].count)).toBe(0);
    });

    it('requires an email on every account, and keeps it unique', async () => {
      const columns = await prisma.$queryRawUnsafe<{ is_nullable: string }[]>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'`,
      );

      expect(columns[0].is_nullable).toBe('NO');

      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      await expect(
        seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD }),
      ).rejects.toThrow();
    });

    it('no longer has the Supabase linkage column at all', async () => {
      const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'`,
      );

      expect(columns.map((c) => c.column_name)).not.toContain('supabase_user_id');
    });
  });

  describe('the audit trail', () => {
    it('records a staff sign-in and never a customer one', async () => {
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });

      await loginAs(app, STAFF_EMAIL, PASSWORD, DEVICE);
      await loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE);

      const rows = await prisma.adminAuditLog.findMany({ where: { action: 'auth.login' } });

      expect(rows).toHaveLength(1);
      expect(rows[0].actorEmail).toBe(STAFF_EMAIL);
    });

    it('records no credential in the row it writes', async () => {
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });

      const tokens = await loginAs(app, STAFF_EMAIL, PASSWORD, DEVICE);
      const rows = await prisma.adminAuditLog.findMany();
      const serialised = JSON.stringify(rows);

      expect(serialised).not.toContain(PASSWORD);
      expect(serialised).not.toContain(tokens.refreshToken);
      expect(serialised).not.toContain(tokens.accessToken);
    });
  });
});

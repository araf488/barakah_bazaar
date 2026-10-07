import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, UserRole } from '../src/infra/prisma/prisma-client';
import { AuthConstants, AuthTokens } from '../src/modules/auth/auth.constants';
import { SecretCipher } from '../src/modules/auth/crypto/secret-cipher';
import { AccessTokenService } from '../src/modules/auth/tokens/access-token.service';
import { PasswordHasher } from '../src/modules/auth/crypto/password-hasher';
import { TotpService } from '../src/modules/auth/crypto/totp.service';
import { EmailVerificationService } from '../src/modules/auth/verification/email-verification.service';
import {
  DATABASE_UNREACHABLE_MESSAGE,
  RecordingEmailSender,
  SEED_SCRYPT_PARAMETERS,
  TEST_DATABASE_URL,
  applyMigrations,
  authHeaders,
  countEmailsTo,
  extractVerificationCode,
  extractVerificationToken,
  isTestDatabaseReachable,
  loginAs,
  resetDatabase,
  seedVerifiedUser,
  settleDetachedWork,
  testPrisma,
  waitForEmailTo,
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
const MFA_SETUP = '/api/v1/auth/mfa/setup';
const MFA_ENABLE = '/api/v1/auth/mfa/enable';
const REGISTER = '/api/v1/auth/register';
const VERIFY_EMAIL = '/api/v1/auth/verify-email';
const RESEND_VERIFICATION = '/api/v1/auth/resend-verification';
const FORGOT_PASSWORD = '/api/v1/auth/forgot-password';
const RESET_PASSWORD = '/api/v1/auth/reset-password';
const CHANGE_PASSWORD = '/api/v1/auth/password';

const INVALID_TOKEN = 'Your session is invalid or has expired. Please sign in again.';
const INVALID_CREDENTIALS = 'Those sign-in details are not correct.';
const RESET_INVALID = 'That password reset link or code is not valid. Please request a new one.';
const RESET_TOO_MANY_ATTEMPTS =
  'Too many incorrect codes. Please request a new password reset email.';
const VERIFICATION_INVALID =
  'That verification link or code is not valid. Please request a new one.';

/**
 * Satisfies `PasswordPolicy`: 12+ characters, all four required character classes, not on the
 * bundled denylist, no identity fragment, no long run. `PASSWORD` above (a plain passphrase)
 * deliberately fails the class-composition rule and is reused below as the "policy refuses it"
 * case rather than inventing a second weak password.
 */
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- fixture value exercising PasswordPolicy, not a credential to anything real
const REGISTRATION_PASSWORD = 'Kiwi9!Lagoon$47';

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
  // Registration/verification mail an EMAIL_PROVIDER=noop app never actually sends. This
  // records it instead, so the registration journey below can read the token and code the
  // way a real recipient would — out of the email, since POST /auth/register never echoes
  // either one back in its response.
  const emailSender = new RecordingEmailSender();

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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthTokens.EmailSender)
      .useValue(emailSender)
      .compile();

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
    emailSender.reset();
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

    // The journey that did not exist until the enrolment routes were built: a staff account
    // that `staffMfaRequired` blocks could obtain an `enrolmentToken` and had nowhere to spend
    // it, so it could never reach a session at all. This walks the whole way through.
    it('a staff account required to enrol can complete enrolment and then sign in', async () => {
      await writeSettings({ staffMfaRequired: true });
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });

      const blocked = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: PASSWORD });

      expect(blocked.body.kind).toBe('enrolment');
      const { enrolmentToken } = blocked.body;

      const setup = await request(app.getHttpServer())
        .post(MFA_SETUP)
        .set('x-device-id', DEVICE)
        .send({ enrolmentToken });

      expect(setup.status).toBe(200);
      expect(setup.body.secret).toEqual(expect.any(String));
      expect(setup.body.otpauthUri).toContain('otpauth://totp/');
      // Stored but not yet confirmed: the factor is not on until `enable` verifies a code.
      expect(await prisma.user.findFirstOrThrow({ where: { email: STAFF_EMAIL } })).toMatchObject({
        totpEnabledAt: null,
      });

      const enable = await request(app.getHttpServer())
        .post(MFA_ENABLE)
        .set('x-device-id', DEVICE)
        .send({ enrolmentToken, code: new TotpService().codeFor(setup.body.secret) });

      expect(enable.status).toBe(200);
      expect(enable.body.recoveryCodes).toHaveLength(10);
      // Enrolling is not a second way to authenticate — no session came out of it.
      expect(enable.body.accessToken).toBeUndefined();
      expect(await prisma.session.count()).toBe(0);

      // Signing in again now asks for the factor rather than demanding enrolment.
      const second = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: PASSWORD });

      expect(second.body.kind).toBe('mfa');

      const finished = await request(app.getHttpServer())
        .post(LOGIN_MFA)
        .set('x-device-id', DEVICE)
        .send({
          mfaToken: second.body.mfaToken,
          // The *next* step's code, not this one's. `enable` just spent the current step, and
          // `totpLastUsedStep` refuses a step already used — so re-presenting the same code
          // here is a replay and is correctly rejected. Worth stating rather than working
          // around silently: it means someone who enrols and immediately signs in waits for
          // the next 30-second window, which is inherent to TOTP replay protection.
          code: new TotpService().codeFor(
            setup.body.secret,
            Date.now() + AuthConstants.TotpStepSeconds * 1000,
          ),
        });

      expect(finished.status).toBe(200);
      expect(finished.body.accessToken).toEqual(expect.any(String));
      expect(await prisma.session.count()).toBe(1);

      // And the session it produced actually works.
      const me = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(finished.body.accessToken, DEVICE));

      expect(me.status).toBe(200);
    });

    it('refuses enrolment with a token this API did not sign', async () => {
      await writeSettings({ staffMfaRequired: true });
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });

      const response = await request(app.getHttpServer())
        .post(MFA_SETUP)
        .set('x-device-id', DEVICE)
        .send({ enrolmentToken: 'not-a-real-token' });

      expect(response.status).toBe(401);
      expect(await prisma.user.findFirstOrThrow({ where: { email: STAFF_EMAIL } })).toMatchObject({
        totpSecretEncrypted: null,
      });
    });

    it('refuses to enable before setup has issued a secret', async () => {
      await writeSettings({ staffMfaRequired: true });
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });

      const blocked = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: PASSWORD });

      const enable = await request(app.getHttpServer())
        .post(MFA_ENABLE)
        .set('x-device-id', DEVICE)
        .send({ enrolmentToken: blocked.body.enrolmentToken, code: '123456' });

      expect(enable.status).toBe(400);
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

  describe('registration and verification', () => {
    /**
     * Registers a fresh account through the real endpoint and returns the token and code the
     * (captured) verification email carried — the only place either one is ever readable, since
     * `POST /auth/register` never returns a credential in its own response.
     */
    const registerAndCapture = async (
      email: string,
      fullName: string,
    ): Promise<{ code: string; token: string }> => {
      await request(app.getHttpServer())
        .post(REGISTER)
        .send({ email, password: REGISTRATION_PASSWORD, fullName });

      const captured = emailSender.latestTo(email);

      return {
        code: extractVerificationCode(captured.body),
        token: extractVerificationToken(captured.body),
      };
    };

    it('registers a pending account with exactly one live verification record', async () => {
      const email = 'pending@barakahbazaar.com.bd';

      const response = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ email, password: REGISTRATION_PASSWORD, fullName: 'Pending Account' });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: 'pending_verification' });

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).toBeNull();

      const verifications = await prisma.emailVerification.findMany({
        where: { userId: user.id },
      });
      expect(verifications).toHaveLength(1);
    });

    it('stores only a hash of the token and the code, never the raw values', async () => {
      const email = 'hashcheck@barakahbazaar.com.bd';
      const { code, token } = await registerAndCapture(email, 'Hash Check');

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const verification = await prisma.emailVerification.findFirstOrThrow({
        where: { userId: user.id },
      });

      expect(verification.tokenHash).toBe(EmailVerificationService.hashCredential(token));
      expect(verification.codeHash).toBe(EmailVerificationService.hashCredential(code));

      const serialised = JSON.stringify(verification);
      expect(serialised).not.toContain(token);
      expect(serialised).not.toContain(code);
    });

    it('verifies with the emailed code and consumes the record', async () => {
      const email = 'verifybycode@barakahbazaar.com.bd';
      const { code } = await registerAndCapture(email, 'Verify Code');

      const response = await request(app.getHttpServer()).post(VERIFY_EMAIL).send({ email, code });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ emailVerified: true });

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).not.toBeNull();

      const verification = await prisma.emailVerification.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(verification.consumedAt).not.toBeNull();
    });

    it('verifies a second account with the link token', async () => {
      const email = 'verifybytoken@barakahbazaar.com.bd';
      const { token } = await registerAndCapture(email, 'Verify Token');

      const response = await request(app.getHttpServer()).post(VERIFY_EMAIL).send({ token });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ emailVerified: true });

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it('refuses a token that was already consumed', async () => {
      const email = 'replaytoken@barakahbazaar.com.bd';
      const { token } = await registerAndCapture(email, 'Replay Token');

      const first = await request(app.getHttpServer()).post(VERIFY_EMAIL).send({ token });
      expect(first.status).toBe(200);

      const replay = await request(app.getHttpServer()).post(VERIFY_EMAIL).send({ token });

      expect(replay.status).toBe(400);
      expect(replay.body.message).toBe(VERIFICATION_INVALID);
    });

    it('answers identically whether or not the address already has an account', async () => {
      const email = 'enumeration@barakahbazaar.com.bd';
      const fullName = 'Enumeration Check';

      const first = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ email, password: REGISTRATION_PASSWORD, fullName });
      const second = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ email, password: REGISTRATION_PASSWORD, fullName });

      expect(first.status).toBe(202);
      expect(second.status).toBe(first.status);
      expect(second.body).toEqual(first.body);
    });

    it('resending twice inside the cooldown still leaves exactly one live verification row', async () => {
      const email = 'resendcooldown@barakahbazaar.com.bd';
      await registerAndCapture(email, 'Resend Cooldown');

      const firstResend = await request(app.getHttpServer())
        .post(RESEND_VERIFICATION)
        .send({ email });
      const secondResend = await request(app.getHttpServer())
        .post(RESEND_VERIFICATION)
        .send({ email });

      expect(firstResend.status).toBe(202);
      expect(secondResend.status).toBe(202);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const liveRows = await prisma.emailVerification.findMany({
        where: { userId: user.id, consumedAt: null },
      });

      expect(liveRows).toHaveLength(1);
    });

    it('rejects a password the policy refuses and creates no account', async () => {
      const email = 'weakpassword@barakahbazaar.com.bd';

      const response = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ email, password: PASSWORD, fullName: 'Weak Password' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'Your password must include an uppercase letter, a lowercase letter, a number and a special character.',
      );

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).toBeNull();
    });

    it('rejects a register payload missing every required field, with field detail', async () => {
      const response = await request(app.getHttpServer()).post(REGISTER).send({});

      expect(response.status).toBe(400);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('rejects a register payload with a malformed email', async () => {
      const response = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ email: 'not-an-email', password: REGISTRATION_PASSWORD, fullName: 'Bad Email' });

      expect(response.status).toBe(400);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('is reachable with no Authorization header at all', async () => {
      const email = 'noauthheader@barakahbazaar.com.bd';

      const response = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ email, password: REGISTRATION_PASSWORD, fullName: 'No Auth Header' });

      expect(response.status).toBe(202);
    });

    it('rejects a verify-email payload carrying both a token and a code', async () => {
      const response = await request(app.getHttpServer())
        .post(VERIFY_EMAIL)
        .send({ token: 'some-token', email: 'someone@example.com', code: '123456' });

      expect(response.status).toBe(400);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('rejects a verify-email payload carrying neither a token nor an email/code pair', async () => {
      const response = await request(app.getHttpServer()).post(VERIFY_EMAIL).send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(VERIFICATION_INVALID);
    });

    it('rejects a verify-email payload with a code but no email', async () => {
      const response = await request(app.getHttpServer())
        .post(VERIFY_EMAIL)
        .send({ code: '123456' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(VERIFICATION_INVALID);
    });

    it('rejects a resend-verification payload with a malformed email', async () => {
      const response = await request(app.getHttpServer())
        .post(RESEND_VERIFICATION)
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('resend-verification is reachable with no Authorization header at all', async () => {
      const response = await request(app.getHttpServer())
        .post(RESEND_VERIFICATION)
        .send({ email: 'whoever@barakahbazaar.com.bd' });

      expect(response.status).toBe(202);
    });

    it('writes no admin audit log row for registration, verification or resend', async () => {
      const before = await prisma.adminAuditLog.count();
      const email = 'noauditrow@barakahbazaar.com.bd';

      const { code } = await registerAndCapture(email, 'No Audit Row');
      await request(app.getHttpServer()).post(VERIFY_EMAIL).send({ email, code });
      await request(app.getHttpServer()).post(RESEND_VERIFICATION).send({ email });

      expect(await prisma.adminAuditLog.count()).toBe(before);
    });
  });

  describe('password reset and change', () => {
    /**
     * Requests a reset through the real endpoint and reads the credential out of the mail. The
     * 202 comes back before the mail is sent, so this waits for a mail newer than any before it.
     */
    const requestAndCapture = async (email: string): Promise<{ code: string; token: string }> => {
      const alreadySeen = countEmailsTo(emailSender, email);
      await request(app.getHttpServer()).post(FORGOT_PASSWORD).send({ email });
      const captured = await waitForEmailTo(emailSender, email, alreadySeen);

      return {
        code: extractVerificationCode(captured.body),
        token: extractVerificationToken(captured.body),
      };
    };

    it('resets by code: old password fails, new one works, every session dies, address verified', async () => {
      await seedVerifiedUser(prisma, {
        email: CUSTOMER_EMAIL,
        password: PASSWORD,
        emailVerified: false,
      });
      const first = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const second = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE);

      const requested = await request(app.getHttpServer())
        .post(FORGOT_PASSWORD)
        .send({ email: CUSTOMER_EMAIL });
      expect(requested.status).toBe(202);
      expect(requested.body).toEqual({ status: 'reset_requested' });

      const code = extractVerificationCode(
        (await waitForEmailTo(emailSender, CUSTOMER_EMAIL)).body,
      );
      const reset = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ email: CUSTOMER_EMAIL, code, newPassword: REGISTRATION_PASSWORD });

      expect(reset.status).toBe(200);
      expect(reset.body).toStrictEqual({ passwordReset: true });

      const oldLogin = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: CUSTOMER_EMAIL, password: PASSWORD });
      expect(oldLogin.status).toBe(401);
      await expect(
        loginAs(app, CUSTOMER_EMAIL, REGISTRATION_PASSWORD, DEVICE),
      ).resolves.toBeDefined();

      for (const [pair, device] of [
        [first, DEVICE],
        [second, OTHER_DEVICE],
      ] as const) {
        const me = await request(app.getHttpServer())
          .get(ME)
          .set(authHeaders(pair.accessToken, device));
        expect(me.status).toBe(401);
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { email: CUSTOMER_EMAIL } });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.passwordChangedAt).not.toBeNull();
    });

    it('refuses a credential issued before the account was disabled, and leaves the password alone', async () => {
      const seeded = await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const { token } = await requestAndCapture(CUSTOMER_EMAIL);
      await prisma.user.update({ where: { id: seeded.id }, data: { isActive: false } });

      const reset = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token, newPassword: REGISTRATION_PASSWORD });

      expect(reset.status).toBe(400);
      expect(reset.body.message).toBe(RESET_INVALID);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: seeded.id } });
      expect(after.passwordHash).toBe(seeded.passwordHash);
      expect(after.passwordChangedAt).toEqual(seeded.passwordChangedAt);
    });

    it('lets only one of two concurrent redemptions of the same token write a password', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const { token } = await requestAndCapture(CUSTOMER_EMAIL);

      const responses = await Promise.all(
        [REGISTRATION_PASSWORD, REGISTRATION_PASSWORD].map((newPassword) =>
          request(app.getHttpServer()).post(RESET_PASSWORD).send({ token, newPassword }),
        ),
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([
        200, 400,
      ]);
      const loser = responses.find((response) => response.status === 400);
      expect(loser?.body.message).toBe(RESET_INVALID);
    });

    it('stores only hashes of the reset token and code', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const { code, token } = await requestAndCapture(CUSTOMER_EMAIL);

      const row = await prisma.passwordReset.findFirstOrThrow({});
      expect(row.tokenHash).toBe(EmailVerificationService.hashCredential(token));
      expect(row.codeHash).toBe(EmailVerificationService.hashCredential(code));
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('answers a replayed token exactly as it answers an unknown one', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const { token } = await requestAndCapture(CUSTOMER_EMAIL);

      const used = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token, newPassword: REGISTRATION_PASSWORD });
      expect(used.status).toBe(200);

      const replay = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token, newPassword: REGISTRATION_PASSWORD });
      const unknown = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token: 'never-issued-token', newPassword: REGISTRATION_PASSWORD });

      expect(replay.status).toBe(400);
      expect(replay.body.message).toBe(RESET_INVALID);
      expect(unknown.status).toBe(replay.status);
      // requestId and timestamp are per-request by design; every other field must match.
      const stable = ({ requestId: _id, timestamp: _at, ...rest }: Record<string, unknown>) => rest;
      expect(stable(unknown.body)).toEqual(stable(replay.body));
    });

    it('answers an unknown address identically, and sends it nothing', async () => {
      const response = await request(app.getHttpServer())
        .post(FORGOT_PASSWORD)
        .send({ email: 'nobody@barakahbazaar.com.bd' });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: 'reset_requested' });
      await settleDetachedWork();
      expect(emailSender.sent).toHaveLength(0);
      expect(await prisma.passwordReset.count()).toBe(0);
    });

    it('finds the account and the code whatever the case of the submitted address', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      await request(app.getHttpServer())
        .post(FORGOT_PASSWORD)
        .send({ email: CUSTOMER_EMAIL.toUpperCase() });
      const code = extractVerificationCode(
        (await waitForEmailTo(emailSender, CUSTOMER_EMAIL)).body,
      );

      const reset = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({
          email: `Shopper@${CUSTOMER_EMAIL.split('@')[1]}`,
          code,
          newPassword: REGISTRATION_PASSWORD,
        });

      expect(reset.status).toBe(200);
    });

    it('a second request after the cooldown kills the first email', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const first = await requestAndCapture(CUSTOMER_EMAIL);
      // Backdate the first row past the 60-second cooldown rather than waiting it out.
      await prisma.passwordReset.updateMany({
        data: { createdAt: new Date(Date.now() - 120_000) },
      });
      const second = await requestAndCapture(CUSTOMER_EMAIL);
      expect(second.token).not.toBe(first.token);

      const stale = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token: first.token, newPassword: REGISTRATION_PASSWORD });
      expect(stale.status).toBe(400);
      expect(stale.body.message).toBe(RESET_INVALID);

      const fresh = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token: second.token, newPassword: REGISTRATION_PASSWORD });
      expect(fresh.status).toBe(200);
    });

    it('refuses a weak new password with the policy message, and the same code then works', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const { code } = await requestAndCapture(CUSTOMER_EMAIL);

      // PASSWORD passes the DTO's length bounds and fails only the four-class rule, so the 400
      // comes from PasswordPolicy.check, not from validation.
      const weak = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ email: CUSTOMER_EMAIL, code, newPassword: PASSWORD });
      expect(weak.status).toBe(400);
      expect(weak.body.message).toBe(
        'Your password must include an uppercase letter, a lowercase letter, a number and a special character.',
      );
      await expect(loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE)).resolves.toBeDefined();

      const strong = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ email: CUSTOMER_EMAIL, code, newPassword: REGISTRATION_PASSWORD });
      expect(strong.status).toBe(200);
    });

    it('returns nothing session-shaped for a staff account, whose second factor stays required', async () => {
      await writeSettings({ staffMfaRequired: true });
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });
      const { token } = await requestAndCapture(STAFF_EMAIL);

      const reset = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token, newPassword: REGISTRATION_PASSWORD });

      expect(reset.status).toBe(200);
      expect(reset.body).toStrictEqual({ passwordReset: true });

      const login = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: REGISTRATION_PASSWORD });
      expect(login.body.kind).toBe('enrolment');
    });

    it('PATCH /auth/password keeps the calling session and ends every other', async () => {
      // PASSWORD fails the four-class rule, so this also proves the current password is never
      // policy-checked.
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const caller = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const other = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE);

      const changed = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set(authHeaders(caller.accessToken, DEVICE))
        .send({ currentPassword: PASSWORD, newPassword: REGISTRATION_PASSWORD });
      expect(changed.status).toBe(204);

      const callerMe = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(caller.accessToken, DEVICE));
      const otherMe = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(other.accessToken, OTHER_DEVICE));
      expect(callerMe.status).toBe(200);
      expect(otherMe.status).toBe(401);

      await expect(
        loginAs(app, CUSTOMER_EMAIL, REGISTRATION_PASSWORD, OTHER_DEVICE),
      ).resolves.toBeDefined();
    });

    it('PATCH /auth/password refuses a wrong current password with the sign-in message', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const caller = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set(authHeaders(caller.accessToken, DEVICE))
        .send({ currentPassword: 'not the right one', newPassword: REGISTRATION_PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(INVALID_CREDENTIALS);
    });

    it('PATCH /auth/password without a token answers 401', async () => {
      const response = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .send({ currentPassword: PASSWORD, newPassword: REGISTRATION_PASSWORD });

      expect(response.status).toBe(401);
    });

    it('rejects a reset payload carrying both a token and a code', async () => {
      const response = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token: 'abc', code: '123456', newPassword: REGISTRATION_PASSWORD });

      expect(response.status).toBe(400);
    });

    it('rejects a reset payload carrying neither a token nor a code', async () => {
      const response = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ email: CUSTOMER_EMAIL, newPassword: REGISTRATION_PASSWORD });

      expect(response.status).toBe(400);
      expect(response.body.message).not.toBe(RESET_INVALID);
    });

    it('rejects a malformed forgot-password payload with 400 and sends nothing', async () => {
      const notAnEmail = await request(app.getHttpServer())
        .post(FORGOT_PASSWORD)
        .send({ email: 'not-an-email' });
      const empty = await request(app.getHttpServer()).post(FORGOT_PASSWORD).send({});

      expect(notAnEmail.status).toBe(400);
      expect(empty.status).toBe(400);
      expect(emailSender.sent).toHaveLength(0);
    });

    it('issues a 32-byte token and a 6-digit code that live exactly 60 minutes', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const { code, token } = await requestAndCapture(CUSTOMER_EMAIL);

      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(code).toMatch(/^\d{6}$/);
      const row = await prisma.passwordReset.findFirstOrThrow({});
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(60 * 60 * 1000, -4);
    });

    it('answers a second request inside the 60-second cooldown identically, and sends nothing', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      await requestAndCapture(CUSTOMER_EMAIL);

      const again = await request(app.getHttpServer())
        .post(FORGOT_PASSWORD)
        .send({ email: CUSTOMER_EMAIL });

      expect(again.status).toBe(202);
      expect(again.body).toEqual({ status: 'reset_requested' });
      await settleDetachedWork();
      expect(emailSender.sent).toHaveLength(1);
      expect(await prisma.passwordReset.count()).toBe(1);
    });

    it('refuses the 5th wrong code with 429, and then the right code too', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const { code } = await requestAndCapture(CUSTOMER_EMAIL);
      const wrong = code === '000000' ? '111111' : '000000';

      const statuses: number[] = [];
      for (let guess = 0; guess < 5; guess += 1) {
        const response = await request(app.getHttpServer())
          .post(RESET_PASSWORD)
          .send({ email: CUSTOMER_EMAIL, code: wrong, newPassword: REGISTRATION_PASSWORD });
        statuses.push(response.status);
      }
      expect(statuses).toEqual([400, 400, 400, 400, 429]);

      const right = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ email: CUSTOMER_EMAIL, code, newPassword: REGISTRATION_PASSWORD });
      expect(right.status).toBe(429);
      expect(right.body.message).toBe(RESET_TOO_MANY_ATTEMPTS);

      const row = await prisma.passwordReset.findFirstOrThrow({});
      expect(row.attempts).toBe(5);
      await expect(loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE)).resolves.toBeDefined();
    });

    it('records auth.password_changed for a staff reset', async () => {
      await seedVerifiedUser(prisma, {
        email: STAFF_EMAIL,
        password: PASSWORD,
        role: UserRole.OPS,
      });
      const { token } = await requestAndCapture(STAFF_EMAIL);

      await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ token, newPassword: REGISTRATION_PASSWORD });

      const rows = await prisma.adminAuditLog.findMany({
        where: { action: 'auth.password_changed' },
      });
      expect(rows).toHaveLength(1);
    });

    it('PATCH /auth/password refuses a weak new password with the policy message', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const caller = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const response = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set(authHeaders(caller.accessToken, DEVICE))
        .send({ currentPassword: PASSWORD, newPassword: PASSWORD });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'Your password must include an uppercase letter, a lowercase letter, a number and a special character.',
      );
      await expect(loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE)).resolves.toBeDefined();
    });
  });

  describe('a password change ends sign-ins that proved the old one', () => {
    const totp = new TotpService();

    /** Enrols TOTP the way the service does, so login sees a genuinely enrolled account. */
    const enrolTotp = async (userId: string): Promise<string> => {
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

    it('an MFA sign-in in flight dies when the password is reset, and a fresh one succeeds', async () => {
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
      expect(started.body.kind).toBe('mfa');

      const alreadySeen = countEmailsTo(emailSender, STAFF_EMAIL);
      await request(app.getHttpServer()).post(FORGOT_PASSWORD).send({ email: STAFF_EMAIL });
      const code = extractVerificationCode(
        (await waitForEmailTo(emailSender, STAFF_EMAIL, alreadySeen)).body,
      );
      const reset = await request(app.getHttpServer())
        .post(RESET_PASSWORD)
        .send({ email: STAFF_EMAIL, code, newPassword: REGISTRATION_PASSWORD });
      expect(reset.status).toBe(200);

      // A genuinely valid code for the current step: the token's stamp is what is refused.
      const stale = await request(app.getHttpServer())
        .post(LOGIN_MFA)
        .set('x-device-id', DEVICE)
        .send({ mfaToken: started.body.mfaToken, code: totp.codeFor(secret) });

      expect(stale.status).toBe(401);
      expect(stale.body.message).toBe(INVALID_CREDENTIALS);
      expect(await prisma.session.count()).toBe(0);

      const again = await request(app.getHttpServer())
        .post(LOGIN)
        .set('x-device-id', DEVICE)
        .send({ email: STAFF_EMAIL, password: REGISTRATION_PASSWORD });
      expect(again.body.kind).toBe('mfa');

      const finished = await request(app.getHttpServer())
        .post(LOGIN_MFA)
        .set('x-device-id', DEVICE)
        .send({
          mfaToken: again.body.mfaToken,
          // The next step's code, so a step the refused attempt may have touched cannot be
          // mistaken for a replay; no 30-second sleep needed.
          code: totp.codeFor(secret, Date.now() + AuthConstants.TotpStepSeconds * 1000),
        });

      expect(finished.status).toBe(200);
      expect(finished.body.accessToken).toEqual(expect.any(String));
      expect(await prisma.session.count()).toBe(1);
    });

    it('a login that rehashes the password still signs in, leaving passwordChangedAt as it was', async () => {
      const changedAt = new Date('2026-05-01T00:00:00.000Z');
      const user = await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      // One cost step below what the app runs at, so this login must rewrite the hash.
      const weaker = new PasswordHasher({
        ...SEED_SCRYPT_PARAMETERS,
        costLog2: SEED_SCRYPT_PARAMETERS.costLog2 - 1,
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await weaker.hash(PASSWORD), passwordChangedAt: changedAt },
      });

      const signedIn = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.passwordHash).toMatch(/^scrypt\$4096\$/);
      expect(row.passwordChangedAt).toEqual(changedAt);
      // Access tokens never carry the credential stamp — only intermediate tokens do.
      const [, payload] = signedIn.accessToken.split('.');
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).not.toHaveProperty(
        'pca',
      );
      const me = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(signedIn.accessToken, DEVICE));
      expect(me.status).toBe(200);
    });

    it('a direct sign-in made before a password change does not survive it', async () => {
      await seedVerifiedUser(prisma, { email: CUSTOMER_EMAIL, password: PASSWORD });
      const before = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, DEVICE);
      const changer = await loginAs(app, CUSTOMER_EMAIL, PASSWORD, OTHER_DEVICE);

      const changed = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set(authHeaders(changer.accessToken, OTHER_DEVICE))
        .send({ currentPassword: PASSWORD, newPassword: REGISTRATION_PASSWORD });
      expect(changed.status).toBe(204);

      const me = await request(app.getHttpServer())
        .get(ME)
        .set(authHeaders(before.accessToken, DEVICE));
      expect(me.status).toBe(401);
    });
  });
});

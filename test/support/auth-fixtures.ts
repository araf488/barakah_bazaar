import { execFileSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient, User, UserRole } from '../../src/infra/prisma/prisma-client';
import { PasswordHasher, ScryptParameters } from '../../src/modules/auth/crypto/password-hasher';

/**
 * Deliberately cheap. Production hashes at 2^15, which costs roughly a second per hash — fine
 * for one login, ruinous for a suite that seeds a user per test. The e2e suite sets the same
 * values in its environment so the app never decides a seeded hash needs rewriting.
 */
export const SEED_SCRYPT_PARAMETERS: ScryptParameters = {
  costLog2: 12,
  blockSize: 8,
  parallelism: 1,
};

/**
 * The database the end-to-end suite runs against — the throwaway `postgres-test` container
 * from docker-compose.yml, or the identically-shaped service container in CI.
 *
 * Read from `TEST_DATABASE_URL`, never from `DATABASE_URL`: the latter is a developer's real
 * project on most machines, and the whole point of the guard below is that this file cannot
 * migrate one of those.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://barakah:barakah@localhost:5433/barakah_test?schema=public';

/** Hosts a migration may be applied to. Anything else is somebody's real data. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * What a developer sees when the container is not up. Named rather than inline so the message
 * that explains how to fix it cannot drift from the check that produces it.
 */
export const DATABASE_UNREACHABLE_MESSAGE =
  `Cannot reach the test database at ${TEST_DATABASE_URL}.\n` +
  'Start it with:  docker compose up -d postgres-test\n' +
  'This suite needs a real Postgres — that is the point of it.';

/**
 * Refuses to go any further unless the target is unmistakably a local throwaway.
 *
 * The standing rule is that migrations are never applied to a live or shared database. A
 * container on localhost that is created empty and discarded after the run is neither — but a
 * mistyped or inherited `TEST_DATABASE_URL` pointing at a Supabase project would be, and the
 * migration this file runs is destructive (it drops a column). So the host is checked rather
 * than trusted, and the failure is loud.
 */
const assertLocal = (url: string): void => {
  const host = new URL(url).hostname;

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to migrate ${host}: the e2e suite only ever touches a local throwaway database. ` +
        'Set TEST_DATABASE_URL to the postgres-test container.',
    );
  }
};

/** True when the test database is up and accepting queries. */
export const isTestDatabaseReachable = async (): Promise<boolean> => {
  const client = testPrisma();

  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
};

/**
 * Applies every migration to the test database.
 *
 * `migrate deploy`, not `migrate dev`: deploy applies the committed migration files and
 * nothing else — it never generates a migration, never resets, and never prompts. The
 * migration history is therefore exercised exactly as a deployment would exercise it, which
 * is the second reason this suite is worth its container: a migration that does not apply
 * cleanly fails here rather than on a real database.
 */
export const applyMigrations = (): void => {
  assertLocal(TEST_DATABASE_URL);

  // `npx` is resolved from PATH by design: this is a test helper run from the repo, and an
  // absolute path would break on every machine whose Node lives somewhere else. The argument
  // list is fixed, and the only thing a caller influences is the connection string, which
  // assertLocal has already constrained to a local throwaway.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: {
      ...process.env,
      // The Prisma CLI reads DIRECT_URL through prisma.config.ts. Both are set so neither a
      // config change nor an inherited value can send this anywhere but the container.
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
    },
    stdio: 'pipe',
  });
};

/**
 * A client bound to the test database, for seeding and for reading state back.
 *
 * Built with the same `pg` driver adapter `PrismaService` uses, because that is how Prisma 7
 * takes a connection string — a `datasourceUrl` option would be ignored by a generated client
 * that expects an adapter.
 */
export const testPrisma = (): PrismaClient =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) });

/**
 * Empties every table this suite writes to, in dependency order.
 *
 * Truncate rather than drop-and-migrate between tests: applying the migrations once per file
 * and clearing rows per test is the difference between a suite that runs in seconds and one
 * nobody waits for.
 */
export const resetDatabase = async (prisma: PrismaClient): Promise<void> => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "public"."sessions", "public"."mfa_recovery_codes", ' +
      '"public"."admin_audit_log", "public"."staff_invitations", "public"."users" CASCADE',
  );
};

export interface SeedUserOptions {
  email: string;
  password: string;
  role?: UserRole;
  /** Defaults to verified: an unverified account is refused once its grace window passes. */
  emailVerified?: boolean;
  isActive?: boolean;
}

/**
 * Writes a user who can actually sign in.
 *
 * The password is hashed with the **real** `PasswordHasher`, at the parameters the running app
 * will verify with. A fixture that wrote its own hash would prove only that the suite and
 * itself agree.
 */
export const seedVerifiedUser = async (
  prisma: PrismaClient,
  options: SeedUserOptions,
): Promise<User> => {
  // The stored format is self-describing, so a hash written at these parameters verifies
  // whatever the running app is configured with. They match the SCRYPT_* values the e2e
  // suite sets, so no login triggers a rehash write nobody asked about.
  const hasher = new PasswordHasher(SEED_SCRYPT_PARAMETERS);

  return prisma.user.create({
    data: {
      email: options.email.toLowerCase(),
      passwordHash: await hasher.hash(options.password),
      role: options.role ?? UserRole.CUSTOMER,
      emailVerifiedAt: (options.emailVerified ?? true) ? new Date() : null,
      isActive: options.isActive ?? true,
    },
  });
};

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/** Signs in through the real endpoint and returns the pair it issued. */
export const loginAs = async (
  app: INestApplication,
  email: string,
  password: string,
  deviceId: string,
): Promise<TokenPair> => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('x-device-id', deviceId)
    .send({ email, password });

  if (response.status !== 200 || response.body.kind !== 'session') {
    throw new Error(
      `loginAs(${email}) expected a session, got ${response.status} ` +
        `${JSON.stringify(response.body)}`,
    );
  }

  return {
    accessToken: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    expiresAt: response.body.expiresAt as string,
  };
};

/** The headers an authenticated request needs: both of them, on every call. */
export const authHeaders = (accessToken: string, deviceId: string): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
  'x-device-id': deviceId,
});

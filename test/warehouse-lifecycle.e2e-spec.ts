import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  PrismaClient,
  ProductVariant,
  StorageType,
  UserRole,
  Warehouse,
} from '../src/infra/prisma/prisma-client';
import { AuthConstants } from '../src/modules/auth/auth.constants';
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

// ConfigModule.forRoot() reads and validates the environment when app.module.ts is imported,
// so every value is set at module scope, before the dynamic import inside beforeAll. Mirrors
// identity.e2e-spec.ts.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
// Only ever the throwaway postgres-test container.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-warehouse-suite-signing-secret-32c';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);
process.env.AUTH_SETTINGS_CACHE_SECONDS = '0';
process.env.SESSION_CACHE_ENABLED = 'false';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.AUTH_ACCOUNT_RATE_LIMIT = '1000';
process.env.WRITE_RATE_LIMIT = '1000';

const DEVICE = 'device-e2e-warehouse';
const PASSWORD = 'correct horse battery staple';
const WAREHOUSE_EMAIL = 'hub-lead@barakahbazaar.com.bd';

const WAREHOUSES = '/api/v1/admin/inventory/warehouses';
const RECEIPTS = '/api/v1/admin/inventory/receipts';
const deactivatePath = (id: string): string => `${WAREHOUSES}/${id}/deactivate`;
const reactivatePath = (id: string): string => `${WAREHOUSES}/${id}/reactivate`;

const LAST_ACTIVE =
  'This is the only active warehouse. Open or reactivate another hub before taking this one out of service.';
const WAREHOUSE_INACTIVE =
  'This warehouse is out of service. Reactivate it before receiving stock into it.';
const LAST_CHILLED =
  'This is the only active hub that can store CHILLED items. Open or reactivate another CHILLED-capable hub first.';
const HOLDS_STOCK =
  'This warehouse still holds stock. Transfer or write it off before deactivating.';

/**
 * The WAREHOUSE hub lifecycle against a real Postgres.
 *
 * The last-active-hub rule is enforced by a transaction-scoped advisory lock and a count taken
 * inside it. A mocked transaction cannot prove either: only a real database shows that the lock
 * statement runs at all, and that two concurrent deactivations are actually serialised.
 *
 * Requires the `postgres-test` container — `docker compose up -d postgres-test`.
 *
 * Shares that database with identity.e2e-spec.ts, whose `resetDatabase` truncates users and the
 * audit log before every test. Run in parallel, each suite would wipe the other's rows mid-test,
 * so both hold `acquireDatabaseSuiteLock` for their whole run.
 */
describe('Warehouse hub lifecycle (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let suiteLock: DatabaseSuiteLock | undefined;

  /** Staff sign in straight to a session here; MFA enrolment is the identity suite's concern. */
  const writeSettings = async (): Promise<void> => {
    const data = { staffMfaRequired: false };

    await prisma.authSettings.upsert({
      where: { id: AuthConstants.AuthSettingsRowId },
      create: { id: AuthConstants.AuthSettingsRowId, ...data },
      update: data,
    });
  };

  /**
   * `resetDatabase` clears identity tables only, and warehouses do not reference users, so
   * `users CASCADE` never reaches them. Cleared here rather than in the shared fixture: this is
   * the only suite that writes hubs, and widening the shared TRUNCATE would cascade through
   * every stock and order table for a suite that never touches them.
   */
  const clearWarehouses = async (): Promise<void> => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."warehouses" CASCADE');
  };

  /**
   * Catalog rows the receipt tests need. Only this suite writes them; `TRUNCATE ... CASCADE`
   * from the category root clears products, variants and every stock row hanging off them.
   */
  const clearCatalog = async (): Promise<void> => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."categories" CASCADE');
  };

  /** A hub written straight to the table, at a real place in the vendored geography. */
  const seedHub = (
    code: string,
    isActive = true,
    storageTypes: StorageType[] = [StorageType.AMBIENT],
  ): Promise<Warehouse> =>
    prisma.warehouse.create({
      data: {
        code,
        nameEn: `${code} Hub`,
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Savar',
        addressLine: 'House 1, Road 1',
        isActive,
        storageTypes,
      },
    });

  /** An active, non-perishable AMBIENT variant that can be received anywhere AMBIENT. */
  const seedVariant = async (): Promise<ProductVariant> => {
    const category = await prisma.category.create({
      data: { slug: 'e2e-dry-goods', nameEn: 'Dry Goods', nameBn: 'শুকনো পণ্য' },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'e2e-red-lentils',
        nameEn: 'Red Lentils',
        nameBn: 'মসুর ডাল',
        categoryId: category.id,
      },
    });
    return prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: 'E2E-LEN-1KG',
        nameEn: '1 kg',
        nameBn: '১ কেজি',
        pricePoysha: 15000n,
        unitLabel: '1kg',
      },
    });
  };

  const signInAs = async (role: UserRole, email: string): Promise<Record<string, string>> => {
    await seedVerifiedUser(prisma, { email, password: PASSWORD, role });
    const tokens = await loginAs(app, email, PASSWORD, DEVICE);
    return authHeaders(tokens.accessToken, DEVICE);
  };

  const activeCount = (): Promise<number> => prisma.warehouse.count({ where: { isActive: true } });

  const deactivationAudits = (entityId?: string) =>
    prisma.adminAuditLog.findMany({
      where: { action: 'warehouse.deactivated', ...(entityId ? { entityId } : {}) },
    });

  const reactivationAudits = () =>
    prisma.adminAuditLog.findMany({ where: { action: 'warehouse.reactivated' } });

  beforeAll(async () => {
    if (!(await isTestDatabaseReachable())) {
      throw new Error(DATABASE_UNREACHABLE_MESSAGE);
    }

    // identity.e2e-spec.ts resets the same tables; wait for it to finish.
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
  }, 120_000);

  afterAll(async () => {
    // Released whatever throws above, or the next database suite waits on a dead holder.
    try {
      // `prisma` is unset when beforeAll failed before creating it.
      if (prisma) {
        await clearCatalog();
        await clearWarehouses();
      }
      await app?.close();
      await prisma?.$disconnect();
    } finally {
      await suiteLock?.release();
    }
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await clearCatalog();
    await clearWarehouses();
    await writeSettings();
  });

  it('a WAREHOUSE user can open, edit and deactivate a hub', async () => {
    await seedHub('DHK-SAV');
    await seedHub('DHK-BAN');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);
    const operator = await prisma.user.findUniqueOrThrow({ where: { email: WAREHOUSE_EMAIL } });

    const opened = await request(app.getHttpServer()).post(WAREHOUSES).set(headers).send({
      code: 'dhk-gul',
      nameEn: 'Gulshan Hub',
      division: 'Dhaka',
      district: 'Dhaka',
      unit: 'Banani',
      addressLine: 'House 12, Road 4',
    });
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({ code: 'DHK-GUL', isActive: true });
    const id = opened.body.id as string;

    const edited = await request(app.getHttpServer())
      .patch(`${WAREHOUSES}/${id}`)
      .set(headers)
      .send({ nameEn: 'Gulshan Main' });
    expect(edited.status).toBe(200);
    expect(edited.body.nameEn).toBe('Gulshan Main');

    const deactivated = await request(app.getHttpServer()).patch(deactivatePath(id)).set(headers);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({
      id,
      isActive: false,
      activeWarehousesRemaining: 2,
    });

    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id } });
    expect(stored.isActive).toBe(false);

    const audits = await deactivationAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: operator.id,
      actorRole: 'WAREHOUSE',
      entityType: 'Warehouse',
      entityId: id,
    });
    expect(audits[0].before).toMatchObject({ isActive: true });
    expect(audits[0].after).toMatchObject({ isActive: false });
  });

  it('re-deactivating an inactive hub answers 200 with the active count and writes no audit row', async () => {
    const retired = await seedHub('DHK-OLD', false);
    await seedHub('DHK-SAV');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);

    const response = await request(app.getHttpServer())
      .patch(deactivatePath(retired.id))
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: retired.id,
      isActive: false,
      activeWarehousesRemaining: 1,
    });
    expect(await deactivationAudits()).toHaveLength(0);
  });

  it('refuses to deactivate the last active hub', async () => {
    const only = await seedHub('DHK-SAV');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);

    const response = await request(app.getHttpServer()).patch(deactivatePath(only.id)).set(headers);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(LAST_ACTIVE);
    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: only.id } });
    expect(stored.isActive).toBe(true);
    expect(await deactivationAudits()).toHaveLength(0);
  });

  it('two concurrent deactivations of the last two hubs leave one active', async () => {
    const first = await seedHub('DHK-SAV');
    const second = await seedHub('DHK-BAN');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);
    const server = app.getHttpServer();

    const responses = await Promise.all([
      request(server).patch(deactivatePath(first.id)).set(headers),
      request(server).patch(deactivatePath(second.id)).set(headers),
    ]);

    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect(await activeCount()).toBe(1);
    expect(await deactivationAudits()).toHaveLength(1);
  });

  it('refuses a receipt into an inactive hub with 409 and writes no stock', async () => {
    const retired = await seedHub('DHK-OLD', false);
    await seedHub('DHK-SAV');
    const variant = await seedVariant();
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);

    const response = await request(app.getHttpServer())
      .post(RECEIPTS)
      .set(headers)
      .send({ warehouseId: retired.id, variantId: variant.id, quantity: 10 });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(WAREHOUSE_INACTIVE);
    expect(await prisma.inventory.count({ where: { warehouseId: retired.id } })).toBe(0);
    expect(await prisma.inventoryBatch.count({ where: { warehouseId: retired.id } })).toBe(0);
  });

  it('refuses to deactivate a hub that holds stock, checked inside the transaction', async () => {
    const stocked = await seedHub('DHK-SAV');
    await seedHub('DHK-BAN');
    const variant = await seedVariant();
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);
    const received = await request(app.getHttpServer())
      .post(RECEIPTS)
      .set(headers)
      .send({ warehouseId: stocked.id, variantId: variant.id, quantity: 4 });
    expect(received.status).toBe(201);

    const response = await request(app.getHttpServer())
      .patch(deactivatePath(stocked.id))
      .set(headers);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(HOLDS_STOCK);
    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: stocked.id } });
    expect(stored.isActive).toBe(true);
  });

  it('deactivate then reactivate round-trips and audits the reactivation once, with the actor', async () => {
    await seedHub('DHK-SAV');
    const hub = await seedHub('DHK-BAN');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);
    const operator = await prisma.user.findUniqueOrThrow({ where: { email: WAREHOUSE_EMAIL } });
    const server = app.getHttpServer();

    const deactivated = await request(server).patch(deactivatePath(hub.id)).set(headers);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({ isActive: false, activeWarehousesRemaining: 1 });

    const reactivated = await request(server).patch(reactivatePath(hub.id)).set(headers);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body).toMatchObject({
      id: hub.id,
      isActive: true,
      activeWarehousesRemaining: 2,
    });

    // A second reactivation is idempotent: 200, no second audit row.
    const again = await request(server).patch(reactivatePath(hub.id)).set(headers);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ isActive: true, activeWarehousesRemaining: 2 });

    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: hub.id } });
    expect(stored.isActive).toBe(true);
    const audits = await reactivationAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: operator.id,
      actorRole: 'WAREHOUSE',
      entityType: 'Warehouse',
      entityId: hub.id,
    });
    expect(audits[0].before).toMatchObject({ isActive: false });
    expect(audits[0].after).toMatchObject({ isActive: true });
  });

  it('answers 404 when reactivating a hub that does not exist', async () => {
    await seedHub('DHK-SAV');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);

    const response = await request(app.getHttpServer())
      .patch(reactivatePath('00000000-0000-4000-8000-000000000000'))
      .set(headers);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Warehouse was not found.');
  });

  it('refuses to deactivate the only CHILLED-capable active hub while an AMBIENT hub remains', async () => {
    const cold = await seedHub('DHK-COLD', true, [StorageType.AMBIENT, StorageType.CHILLED]);
    await seedHub('DHK-SAV');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);

    const response = await request(app.getHttpServer()).patch(deactivatePath(cold.id)).set(headers);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(LAST_CHILLED);
    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: cold.id } });
    expect(stored.isActive).toBe(true);
    expect(await deactivationAudits()).toHaveLength(0);
  });

  it('refuses to edit CHILLED out of the only cold hub', async () => {
    const cold = await seedHub('DHK-COLD', true, [StorageType.AMBIENT, StorageType.CHILLED]);
    await seedHub('DHK-SAV');
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);

    const response = await request(app.getHttpServer())
      .patch(`${WAREHOUSES}/${cold.id}`)
      .set(headers)
      .send({ storageTypes: [StorageType.AMBIENT] });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(LAST_CHILLED);
    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: cold.id } });
    expect(stored.storageTypes).toEqual([StorageType.AMBIENT, StorageType.CHILLED]);
  });

  it('allows editing CHILLED out of a hub when another active hub holds it', async () => {
    const cold = await seedHub('DHK-COLD', true, [StorageType.AMBIENT, StorageType.CHILLED]);
    await seedHub('DHK-CHL', true, [StorageType.CHILLED]);
    const headers = await signInAs(UserRole.WAREHOUSE, WAREHOUSE_EMAIL);

    const response = await request(app.getHttpServer())
      .patch(`${WAREHOUSES}/${cold.id}`)
      .set(headers)
      .send({ storageTypes: [StorageType.AMBIENT] });

    expect(response.status).toBe(200);
    expect(response.body.storageTypes).toEqual([StorageType.AMBIENT]);
  });

  it.each([UserRole.MARKETING, UserRole.OPS, UserRole.SUPPORT])(
    '%s cannot open a hub',
    async (role) => {
      const headers = await signInAs(role, `${role.toLowerCase()}@barakahbazaar.com.bd`);

      const response = await request(app.getHttpServer()).post(WAREHOUSES).set(headers).send({
        code: 'DHK-GUL',
        nameEn: 'Gulshan Hub',
        division: 'Dhaka',
        district: 'Dhaka',
        unit: 'Banani',
        addressLine: 'House 12, Road 4',
      });

      expect(response.status).toBe(403);
      expect(await prisma.warehouse.count()).toBe(0);
    },
  );
});

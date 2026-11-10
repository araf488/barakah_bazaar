import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  ProductVariant,
  User,
  Warehouse,
} from '../src/infra/prisma/prisma-client';
import {
  DATABASE_UNREACHABLE_MESSAGE,
  DatabaseSuiteLock,
  SEED_SCRYPT_PARAMETERS,
  TEST_DATABASE_URL,
  acquireDatabaseSuiteLock,
  applyMigrations,
  isTestDatabaseReachable,
  resetDatabase,
  seedVerifiedUser,
  testPrisma,
} from './support/auth-fixtures';

// Same module-scope environment as warehouse-lifecycle.e2e-spec.ts: ConfigModule validates it
// when app.module.ts is imported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
// Only ever the throwaway postgres-test container.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-hold-sweep-suite-signing-secret-32c';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);

const HOUR_MS = 3_600_000;

/**
 * The expired-hold query against a real Postgres.
 *
 * It is raw SQL joining a polymorphic text reference to a uuid primary key, so only a real
 * database proves the cast, the enum literals and the ordering. The point of the filters being
 * inside the query: paid CONFIRMED orders keep an expired, unreleased hold until dispatch, and
 * must not crowd abandoned orders out of the batch.
 */
describe('Expired order holds (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let suiteLock: DatabaseSuiteLock | undefined;
  let repository: {
    findExpiredHolds(): Promise<{ id: string }[] | null>;
  };
  let customer: User;
  let hub: Warehouse;
  let variant: ProductVariant;

  const clearCatalogAndHubs = async (): Promise<void> => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."warehouses" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."categories" CASCADE');
  };

  /** An order with a hold that expired `expiredHoursAgo` hours ago (or is still live if negative). */
  const seedHeldOrder = async (
    orderNumber: string,
    status: OrderStatus,
    paymentStatus: PaymentStatus,
    expiredHoursAgo: number,
  ): Promise<string> => {
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: customer.id,
        warehouseId: hub.id,
        status,
        paymentStatus,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        recipientName: 'Rahim',
        phone: '+8801712345678',
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Savar',
        addressLine: 'House 12',
        subtotalPoysha: 15000n,
        totalPoysha: 15000n,
      },
    });

    await prisma.stockReservation.create({
      data: {
        warehouseId: hub.id,
        variantId: variant.id,
        quantity: 1,
        referenceType: 'Order',
        referenceId: order.id,
        expiresAt: new Date(Date.now() - expiredHoursAgo * HOUR_MS),
      },
    });

    return order.id;
  };

  beforeAll(async () => {
    if (!(await isTestDatabaseReachable())) {
      throw new Error(DATABASE_UNREACHABLE_MESSAGE);
    }

    suiteLock = await acquireDatabaseSuiteLock();
    applyMigrations();
    prisma = testPrisma();

    const { AppModule } = await import('../src/app.module');
    const { OrderRepository } = await import('../src/modules/order/order.repository');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    repository = app.get(OrderRepository);
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await clearCatalogAndHubs();
      }
      await app?.close();
      await prisma?.$disconnect();
    } finally {
      await suiteLock?.release();
    }
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await clearCatalogAndHubs();

    customer = await seedVerifiedUser(prisma, {
      email: 'holds@barakahbazaar.com.bd',
      password: 'correct horse battery staple',
    });
    hub = await prisma.warehouse.create({
      data: {
        code: 'DHK-HLD',
        nameEn: 'Hold Hub',
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Savar',
        addressLine: 'House 1, Road 1',
      },
    });
    const category = await prisma.category.create({
      data: { slug: 'e2e-holds', nameEn: 'Holds', nameBn: 'হোল্ড' },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'e2e-hold-product',
        nameEn: 'Hold Product',
        nameBn: 'হোল্ড পণ্য',
        categoryId: category.id,
      },
    });
    variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: 'E2E-HLD-1',
        nameEn: '1 kg',
        nameBn: '১ কেজি',
        pricePoysha: 15000n,
        unitLabel: '1kg',
      },
    });
  });

  it('returns only open, unpaid orders whose hold has expired', async () => {
    const abandoned = await seedHeldOrder(
      'BB-HOLD-1',
      OrderStatus.PLACED,
      PaymentStatus.PENDING,
      2,
    );
    const confirmedUnpaid = await seedHeldOrder(
      'BB-HOLD-2',
      OrderStatus.CONFIRMED,
      PaymentStatus.PENDING,
      3,
    );
    await seedHeldOrder('BB-HOLD-3', OrderStatus.CONFIRMED, PaymentStatus.PAID, 4);
    await seedHeldOrder('BB-HOLD-4', OrderStatus.PICKING, PaymentStatus.PENDING, 5);
    await seedHeldOrder('BB-HOLD-5', OrderStatus.PLACED, PaymentStatus.PENDING, -1);

    const found = await repository.findExpiredHolds();

    expect(found).toHaveLength(2);
    expect(found?.map((order) => order.id)).toEqual(
      expect.arrayContaining([abandoned, confirmedUnpaid]),
    );
  });

  it('is not starved by 100 paid orders with older expired holds', async () => {
    for (let index = 0; index < 100; index += 1) {
      await seedHeldOrder(
        `BB-PAID-${index}`,
        OrderStatus.CONFIRMED,
        PaymentStatus.PAID,
        48 + index,
      );
    }
    const abandoned = await seedHeldOrder(
      'BB-HOLD-A',
      OrderStatus.PLACED,
      PaymentStatus.PENDING,
      1,
    );

    const found = await repository.findExpiredHolds();

    expect(found?.map((order) => order.id)).toEqual([abandoned]);
  }, 60_000);

  it('hands back the oldest holds first when more than a batch has expired', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 101; index += 1) {
      // Index 0 expired longest ago; index 100 most recently.
      ids.push(
        await seedHeldOrder(
          `BB-OLD-${index}`,
          OrderStatus.PLACED,
          PaymentStatus.PENDING,
          200 - index,
        ),
      );
    }

    const found = await repository.findExpiredHolds();

    expect(found).toHaveLength(100);
    expect(found?.map((order) => order.id)).not.toContain(ids[100]);
  }, 60_000);
});

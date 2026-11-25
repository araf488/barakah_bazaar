import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  PrismaClient,
  ProductVariant,
  User,
  Warehouse,
} from '../src/infra/prisma/prisma-client';
import type { PaymentRepository } from '../src/modules/payment/payment.repository';
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

// Same module-scope environment as order-hold-sweep.e2e-spec.ts: ConfigModule validates it
// when app.module.ts is imported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
// Only ever the throwaway postgres-test container.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-payment-ledger-suite-signing-secret';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);

const MINUTE_MS = 60_000;
const ORDER_TOTAL = 25000n;

/**
 * The bKash ledger queries against a real Postgres.
 *
 * The refunds-owed formula and the capture's order lock are raw SQL (enum columns compared as
 * text, a uuid cast, a lateral join), and a duplicate trxID must surface as Prisma's P2002
 * under the pg adapter. Only a real database proves any of that.
 */
describe('Payment ledger (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let suiteLock: DatabaseSuiteLock | undefined;
  let repository: PaymentRepository;
  let customer: User;
  let hub: Warehouse;
  let variant: ProductVariant;
  let orderCount = 0;

  const clearCatalogAndHubs = async (): Promise<void> => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."warehouses" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."categories" CASCADE');
  };

  const seedOrder = async (
    status: OrderStatus,
    paymentMethod: PaymentMethod,
    paymentStatus: PaymentStatus,
  ): Promise<string> => {
    orderCount += 1;
    const order = await prisma.order.create({
      data: {
        orderNumber: `BB-LEDGER-${orderCount}`,
        userId: customer.id,
        warehouseId: hub.id,
        status,
        paymentStatus,
        paymentMethod,
        recipientName: 'Rahim',
        phone: '+8801712345678',
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Savar',
        addressLine: 'House 12',
        subtotalPoysha: ORDER_TOTAL,
        totalPoysha: ORDER_TOTAL,
      },
    });
    return order.id;
  };

  /** A bKash charge on the order. Captured ones get a trxID and a capture time. */
  const seedCharge = async (
    orderId: string,
    paymentId: string,
    trxId: string | null,
    capturedMinutesAgo = 10,
  ): Promise<PaymentTransaction> =>
    await prisma.paymentTransaction.create({
      data: {
        orderId,
        method: PaymentMethod.BKASH,
        direction: PaymentDirection.CHARGE,
        status: trxId ? PaymentTransactionStatus.CAPTURED : PaymentTransactionStatus.PENDING,
        amountPoysha: ORDER_TOTAL,
        gatewayReference: paymentId,
        gatewayTransactionId: trxId,
        capturedAt: trxId ? new Date(Date.now() - capturedMinutesAgo * MINUTE_MS) : null,
      },
    });

  /** Claims and completes an automatic refund, as `refundNow` does around the bKash call. */
  const refundCharge = async (
    orderId: string,
    charge: PaymentTransaction,
    amountPoysha: bigint,
    refundTransactionId: string | null,
    markRefunded: boolean,
  ): Promise<PaymentTransaction> => {
    const claim = await repository.claimRefund(orderId, charge, amountPoysha);
    if (claim === null || claim === 'claimed') {
      throw new Error(`refund claim refused: ${String(claim)}`);
    }
    await expect(
      repository.completeRefund(claim.id, refundTransactionId, markRefunded),
    ).resolves.toBe(true);
    return await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: claim.id } });
  };

  beforeAll(async () => {
    if (!(await isTestDatabaseReachable())) {
      throw new Error(DATABASE_UNREACHABLE_MESSAGE);
    }

    suiteLock = await acquireDatabaseSuiteLock();
    applyMigrations();
    prisma = testPrisma();

    const { AppModule } = await import('../src/app.module');
    const { PaymentRepository: Repository } =
      await import('../src/modules/payment/payment.repository');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    repository = app.get(Repository);
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
      email: 'ledger@barakahbazaar.com.bd',
      password: 'correct horse battery staple',
    });
    hub = await prisma.warehouse.create({
      data: {
        code: 'DHK-LDG',
        nameEn: 'Ledger Hub',
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Savar',
        addressLine: 'House 1, Road 1',
      },
    });
    const category = await prisma.category.create({
      data: { slug: 'e2e-ledger', nameEn: 'Ledger', nameBn: 'লেজার' },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'e2e-ledger-product',
        nameEn: 'Ledger Product',
        nameBn: 'লেজার পণ্য',
        categoryId: category.id,
      },
    });
    variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: 'E2E-LDG-1',
        nameEn: '1 kg',
        nameBn: '১ কেজি',
        pricePoysha: ORDER_TOTAL,
        unitLabel: '1kg',
      },
    });
  });

  describe('findRefundsOwed', () => {
    it('finds exactly the orders holding money they may not keep, newest charge first', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const cancelledCharge = await seedCharge(cancelled, 'PAY-C', 'TRX-C');

      const switchedToCod = await seedOrder(
        OrderStatus.PLACED,
        PaymentMethod.CASH_ON_DELIVERY,
        PaymentStatus.PENDING,
      );
      const codCharge = await seedCharge(switchedToCod, 'PAY-S', 'TRX-S');

      const twoCaptures = await seedOrder(
        OrderStatus.CONFIRMED,
        PaymentMethod.BKASH,
        PaymentStatus.PAID,
      );
      await seedCharge(twoCaptures, 'PAY-T1', 'TRX-T1', 20);
      const newerCharge = await seedCharge(twoCaptures, 'PAY-T2', 'TRX-T2', 5);

      const paidOnce = await seedOrder(
        OrderStatus.DELIVERED,
        PaymentMethod.BKASH,
        PaymentStatus.PAID,
      );
      await seedCharge(paidOnce, 'PAY-P', 'TRX-P');
      await seedCharge(paidOnce, 'PAY-P2', null);

      const alreadyRefunded = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.REFUNDED,
      );
      const refundedCharge = await seedCharge(alreadyRefunded, 'PAY-R', 'TRX-R');
      await refundCharge(alreadyRefunded, refundedCharge, ORDER_TOTAL, 'RFD-R', true);

      const owed = await repository.findRefundsOwed(50);

      expect(owed).toHaveLength(3);
      expect(owed).toEqual(
        expect.arrayContaining([
          {
            orderId: cancelled,
            charge: cancelledCharge,
            amountPoysha: ORDER_TOTAL,
            markRefunded: true,
          },
          {
            orderId: switchedToCod,
            charge: codCharge,
            amountPoysha: ORDER_TOTAL,
            markRefunded: false,
          },
          {
            orderId: twoCaptures,
            charge: newerCharge,
            amountPoysha: ORDER_TOTAL,
            markRefunded: false,
          },
        ]),
      );
    });

    it('stops owing once the refund is recorded, and marks a cancelled order REFUNDED', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const charge = await seedCharge(cancelled, 'PAY-C', 'TRX-C');

      const refund = await refundCharge(cancelled, charge, ORDER_TOTAL, 'RFD-C', true);

      expect(refund).toMatchObject({
        direction: PaymentDirection.REFUND,
        status: PaymentTransactionStatus.CAPTURED,
        gatewayReference: 'refund:TRX-C',
        gatewayTransactionId: 'RFD-C',
        amountPoysha: ORDER_TOTAL,
        collectedBy: null,
      });
      await expect(repository.findRefundsOwed(50)).resolves.toEqual([]);
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: cancelled } }),
      ).resolves.toMatchObject({ paymentStatus: PaymentStatus.REFUNDED });
      await expect(repository.claimRefund(cancelled, charge, ORDER_TOTAL)).resolves.toBe('claimed');
    });

    it('re-evaluates to the older charge once the newer one has its refund row', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const older = await seedCharge(cancelled, 'PAY-OLD', 'TRX-OLD', 20);
      const newer = await seedCharge(cancelled, 'PAY-NEW', 'TRX-NEW', 5);

      // Both charges are owed: the first refund must not mark the order REFUNDED yet.
      await expect(repository.findRefundsOwed(50)).resolves.toEqual([
        { orderId: cancelled, charge: newer, amountPoysha: ORDER_TOTAL, markRefunded: false },
      ]);
      await refundCharge(cancelled, newer, ORDER_TOTAL, 'RFD-NEW', false);

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([
        { orderId: cancelled, charge: older, amountPoysha: ORDER_TOTAL, markRefunded: true },
      ]);
    });

    it('refunds only what a staff partial refund left owed on a cancelled order', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PAID,
      );
      const charge = await seedCharge(cancelled, 'PAY-C', 'TRX-C');
      await prisma.paymentTransaction.create({
        data: {
          orderId: cancelled,
          method: PaymentMethod.BKASH,
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.CAPTURED,
          amountPoysha: 10000n,
          gatewayReference: 'STAFF-RFD-1',
          capturedAt: new Date(),
        },
      });

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([
        { orderId: cancelled, charge, amountPoysha: 15000n, markRefunded: true },
      ]);
      await refundCharge(cancelled, charge, 15000n, 'RFD-C', true);

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([]);
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: cancelled } }),
      ).resolves.toMatchObject({ paymentStatus: PaymentStatus.REFUNDED });
    });

    it('applies the batch limit after the owed filter, so paid orders cannot starve it', async () => {
      for (let index = 0; index < 3; index += 1) {
        const paid = await seedOrder(
          OrderStatus.CONFIRMED,
          PaymentMethod.BKASH,
          PaymentStatus.PAID,
        );
        await seedCharge(paid, `PAY-OK-${index}`, `TRX-OK-${index}`, 60 + index);
      }
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      await seedCharge(cancelled, 'PAY-C', 'TRX-C', 1);

      const owed = await repository.findRefundsOwed(1);

      expect(owed?.map((entry) => entry.orderId)).toEqual([cancelled]);
    });
  });

  describe('refund claims', () => {
    it('keeps a claimed charge out of the owed read and nets the claim as in flight', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const older = await seedCharge(cancelled, 'PAY-OLD', 'TRX-OLD', 20);
      const newer = await seedCharge(cancelled, 'PAY-NEW', 'TRX-NEW', 5);

      const claim = await repository.claimRefund(cancelled, newer, ORDER_TOTAL);

      expect(claim).toMatchObject({
        direction: PaymentDirection.REFUND,
        status: PaymentTransactionStatus.PENDING,
        gatewayReference: 'refund:TRX-NEW',
        capturedAt: null,
      });
      // The newer charge is claimed, so the older one is next; with the claim netted, the
      // older refund is the one that clears the order.
      await expect(repository.findRefundsOwed(50)).resolves.toEqual([
        { orderId: cancelled, charge: older, amountPoysha: ORDER_TOTAL, markRefunded: true },
      ]);
    });

    it('never offers a kept charge while the refund of a second capture is in flight', async () => {
      const paid = await seedOrder(OrderStatus.CONFIRMED, PaymentMethod.BKASH, PaymentStatus.PAID);
      await seedCharge(paid, 'PAY-KEPT', 'TRX-KEPT', 20);
      const second = await seedCharge(paid, 'PAY-SECOND', 'TRX-SECOND', 1);

      await repository.claimRefund(paid, second, ORDER_TOTAL);

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([]);
      await expect(repository.findRefundOwedForOrder(paid)).resolves.toBeUndefined();
    });

    it('lets exactly one caller claim a charge, and counts no money until it completes', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const charge = await seedCharge(cancelled, 'PAY-C', 'TRX-C');

      const claims = await Promise.all([
        repository.claimRefund(cancelled, charge, ORDER_TOTAL),
        repository.claimRefund(cancelled, charge, ORDER_TOTAL),
      ]);

      expect(claims.filter((claim) => claim === 'claimed')).toHaveLength(1);
      await expect(repository.totalsForOrder(cancelled)).resolves.toEqual({
        capturedPoysha: ORDER_TOTAL,
        refundedPoysha: 0n,
      });
      await expect(repository.sumPendingRefundClaims(cancelled)).resolves.toBe(ORDER_TOTAL);
    });

    it('completes a claim once, with the refund trxID, and marks the order REFUNDED', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const charge = await seedCharge(cancelled, 'PAY-C', 'TRX-C');
      const claim = (await repository.claimRefund(
        cancelled,
        charge,
        ORDER_TOTAL,
      )) as PaymentTransaction;

      await expect(repository.completeRefund(claim.id, 'RFD-C', true)).resolves.toBe(true);
      await expect(repository.completeRefund(claim.id, 'RFD-C', true)).resolves.toBe(false);
      await expect(repository.releaseRefundClaim(claim.id)).resolves.toBe(false);

      await expect(
        prisma.paymentTransaction.findUniqueOrThrow({ where: { id: claim.id } }),
      ).resolves.toMatchObject({
        status: PaymentTransactionStatus.CAPTURED,
        gatewayTransactionId: 'RFD-C',
        capturedAt: expect.any(Date) as Date,
      });
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: cancelled } }),
      ).resolves.toMatchObject({ paymentStatus: PaymentStatus.REFUNDED });
    });

    it('owes the charge again once a refused claim is released', async () => {
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const charge = await seedCharge(cancelled, 'PAY-C', 'TRX-C');
      const claim = (await repository.claimRefund(
        cancelled,
        charge,
        ORDER_TOTAL,
      )) as PaymentTransaction;

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([]);
      await expect(repository.releaseRefundClaim(claim.id)).resolves.toBe(true);

      await expect(repository.findRefundsOwed(50)).resolves.toEqual([
        { orderId: cancelled, charge, amountPoysha: ORDER_TOTAL, markRefunded: true },
      ]);
    });
  });

  describe('findRefundOwedForOrder', () => {
    it('answers only the named order, with the full charge and markRefunded on a cancel', async () => {
      const other = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      await seedCharge(other, 'PAY-OTHER', 'TRX-OTHER', 30);
      const cancelled = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const charge = await seedCharge(cancelled, 'PAY-LATE', 'TRX-LATE', 1);

      await expect(repository.findRefundOwedForOrder(cancelled)).resolves.toEqual({
        orderId: cancelled,
        charge,
        amountPoysha: ORDER_TOTAL,
        markRefunded: true,
      });
    });

    it('answers undefined for a paid order that keeps its one charge', async () => {
      const paid = await seedOrder(OrderStatus.CONFIRMED, PaymentMethod.BKASH, PaymentStatus.PAID);
      await seedCharge(paid, 'PAY-KEPT', 'TRX-KEPT');

      await expect(repository.findRefundOwedForOrder(paid)).resolves.toBeUndefined();
    });
  });

  describe('captureAttempt', () => {
    it('confirms a PLACED bKash order as PAID with one event, and only once', async () => {
      const orderId = await seedOrder(
        OrderStatus.PLACED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const attempt = await seedCharge(orderId, 'PAY-1', null);

      const first = await repository.captureAttempt(attempt.id, 'TRX-1');
      const second = await repository.captureAttempt(attempt.id, 'TRX-1');

      expect(first).toMatchObject({
        kind: 'confirmed',
        order: { id: orderId, status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID },
      });
      expect(second).toEqual({ kind: 'already-settled' });
      await expect(
        prisma.orderEvent.findMany({ where: { orderId }, select: { toStatus: true, note: true } }),
      ).resolves.toEqual([{ toStatus: OrderStatus.CONFIRMED, note: 'Paid by bKash.' }]);
      await expect(
        prisma.paymentTransaction.findUniqueOrThrow({ where: { id: attempt.id } }),
      ).resolves.toMatchObject({
        status: PaymentTransactionStatus.CAPTURED,
        gatewayTransactionId: 'TRX-1',
      });
    });

    it('commits the capture alone and answers refund-due for a cancelled order', async () => {
      const orderId = await seedOrder(
        OrderStatus.CANCELLED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const attempt = await seedCharge(orderId, 'PAY-1', null);

      await expect(repository.captureAttempt(attempt.id, 'TRX-1')).resolves.toEqual({
        kind: 'refund-due',
        orderId,
      });
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      ).resolves.toMatchObject({
        status: OrderStatus.CANCELLED,
        paymentStatus: PaymentStatus.PENDING,
      });
      await expect(repository.findRefundsOwed(50)).resolves.toEqual([
        expect.objectContaining({ orderId, markRefunded: true }),
      ]);
    });

    it('answers already-settled when the trxID is already recorded on another attempt', async () => {
      const orderId = await seedOrder(
        OrderStatus.PLACED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      await seedCharge(orderId, 'PAY-OLD', 'TRX-1');
      const attempt = await seedCharge(orderId, 'PAY-NEW', null);

      await expect(repository.captureAttempt(attempt.id, 'TRX-1')).resolves.toEqual({
        kind: 'already-settled',
      });
    });
  });

  describe('createAttempt', () => {
    it('extends only the holds that would lapse first, and refuses a repeated paymentID', async () => {
      const orderId = await seedOrder(
        OrderStatus.PLACED,
        PaymentMethod.BKASH,
        PaymentStatus.PENDING,
      );
      const holdUntil = new Date(Date.now() + 15 * MINUTE_MS);
      const reserve = async (expiresInMinutes: number) =>
        await prisma.stockReservation.create({
          data: {
            warehouseId: hub.id,
            variantId: variant.id,
            quantity: 1,
            referenceType: 'Order',
            referenceId: orderId,
            expiresAt: new Date(Date.now() + expiresInMinutes * MINUTE_MS),
          },
        });
      const short = await reserve(5);
      const long = await reserve(60);

      await expect(
        repository.createAttempt(
          { orderId, amountPoysha: ORDER_TOTAL, paymentId: 'PAY-1' },
          holdUntil,
        ),
      ).resolves.toMatchObject({
        status: PaymentTransactionStatus.PENDING,
        gatewayReference: 'PAY-1',
      });
      await expect(
        repository.createAttempt(
          { orderId, amountPoysha: ORDER_TOTAL, paymentId: 'PAY-1' },
          holdUntil,
        ),
      ).resolves.toBe('duplicate');

      await expect(
        prisma.stockReservation.findUniqueOrThrow({ where: { id: short.id } }),
      ).resolves.toMatchObject({ expiresAt: holdUntil });
      await expect(
        prisma.stockReservation.findUniqueOrThrow({ where: { id: long.id } }),
      ).resolves.toMatchObject({ expiresAt: long.expiresAt });
    });
  });
});

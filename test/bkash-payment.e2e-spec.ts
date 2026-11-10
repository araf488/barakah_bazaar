import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  Order,
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  PrismaClient,
} from '../src/infra/prisma/prisma-client';
import { AuthTokens } from '../src/modules/auth/auth.constants';
import type { ReservationSweeper } from '../src/modules/order/reservation-sweeper.service';
import type { BkashReconciliationSweeper } from '../src/modules/payment/bkash-reconciliation.sweeper';
import { NotificationTokens } from '../src/modules/notification/notification.constants';
import { PaymentTokens } from '../src/modules/payment/payment.constants';
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
import { SeededStore, clearStore, placeBkashOrder, seedStore } from './support/order-fixtures';
import { FakeBkashGateway, completedOutcome, refundRefused } from './support/payment-fixtures';
import { RecordingSmsGateway } from './support/sms-fixtures';

// ConfigModule.forRoot() reads the environment when app.module.ts is imported, so everything
// is set at module scope, before the dynamic import inside beforeAll.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-bkash-payment-suite-signing-secret-32c';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SCRYPT_COST_LOG2 = String(SEED_SCRYPT_PARAMETERS.costLog2);
process.env.SCRYPT_BLOCK_SIZE = String(SEED_SCRYPT_PARAMETERS.blockSize);
process.env.SCRYPT_PARALLELISM = String(SEED_SCRYPT_PARAMETERS.parallelism);
process.env.SESSION_CACHE_ENABLED = 'false';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.AUTH_ACCOUNT_RATE_LIMIT = '1000';
process.env.WRITE_RATE_LIMIT = '1000';
process.env.APP_PUBLIC_BASE_URL = 'http://localhost:3000';

/**
 * Jest may run several spec files in one worker process and `process.env` is shared, so the
 * payment settings this suite switches on go back afterwards. The bKash credentials are
 * placeholders: the gateway is replaced by a fake, so nothing ever calls them.
 */
const PAYMENT_ENV = {
  PAYMENT_PROVIDER: 'bkash',
  PAYMENT_API_URL: 'https://bkash.invalid',
  PAYMENT_APP_KEY: 'e2e-app-key',
  PAYMENT_APP_SECRET: 'e2e-app-secret',
  PAYMENT_USERNAME: 'e2e-username',
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- placeholder for a gateway that is faked, not a credential to anything
  PAYMENT_PASSWORD: 'e2e-password',
  API_PUBLIC_BASE_URL: 'https://api.e2e.barakahbazaar.test',
} as const;

const originalPaymentEnv: Record<string, string | undefined> = {};
for (const [key, value] of Object.entries(PAYMENT_ENV)) {
  originalPaymentEnv[key] = process.env[key];
  process.env[key] = value;
}

const PASSWORD = 'correct horse battery staple';
const DEVICE = 'device-e2e-bkash';
const RESULT = 'http://localhost:3000/checkout/payment-result';
const CALLBACK = '/api/v1/payments/bkash/callback';
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const CUSTOMER_EMAIL = 'bkash-customer@barakahbazaar.com.bd';
const STRANGER_EMAIL = 'bkash-stranger@barakahbazaar.com.bd';

/** The CONFIRMED text the customer reads (the default language is Bangla). */
const CONFIRMED_SMS_FRAGMENT = 'নিশ্চিত হয়েছে';
const CONFIRMED_TEMPLATE = 'order.confirmed';

interface Session {
  accessToken: string;
  deviceId: string;
}

/**
 * bKash Tokenized Checkout, end to end: a real Postgres, the real pipeline from the HTTP
 * request down, and a fake gateway that records every call it is asked to make.
 */
describe('bKash payment (end to end)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let suiteLock: DatabaseSuiteLock | undefined;
  let reservationSweeper: ReservationSweeper;
  let reconciliationSweeper: BkashReconciliationSweeper;
  let store: SeededStore;
  let session: Session;
  const gateway = new FakeBkashGateway();
  const sms = new RecordingSmsGateway();

  const signIn = async (email: string): Promise<Session> => {
    await seedVerifiedUser(prisma, { email, password: PASSWORD });
    const tokens = await loginAs(app, email, PASSWORD, DEVICE);
    return { accessToken: tokens.accessToken, deviceId: DEVICE };
  };

  const headers = (who: Session = session): Record<string, string> =>
    authHeaders(who.accessToken, who.deviceId);

  /** A BKASH order for the signed-in customer, placed through the real API. */
  const placeOrder = (): ReturnType<typeof placeBkashOrder> =>
    placeBkashOrder(app, session, store.variant.id);

  const startPayment = (orderId: string, who: Session = session): request.Test =>
    request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/payments/bkash`).set(headers(who));

  /** Starts a payment, expects 201, and returns the `paymentID` the fake issued for it. */
  const openAttempt = async (orderId: string): Promise<string> => {
    const started = await startPayment(orderId);
    expect(started.status).toBe(201);
    return gateway.latestPaymentId();
  };

  const callback = (paymentId: string, status = 'success'): request.Test =>
    request(app.getHttpServer()).get(CALLBACK).query({ paymentID: paymentId, status });

  const resultUrl = (orderNumber: string, outcome: string): string =>
    `${RESULT}?order=${orderNumber}&outcome=${outcome}`;

  const orderRow = (id: string): Promise<Order> =>
    prisma.order.findUniqueOrThrow({ where: { id } });

  const ledger = (orderId: string): Promise<PaymentTransaction[]> =>
    prisma.paymentTransaction.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });

  const confirmedEvents = (orderId: string): Promise<number> =>
    prisma.orderEvent.count({ where: { orderId, toStatus: OrderStatus.CONFIRMED } });

  const confirmedNotifications = (orderId: string): Promise<number> =>
    prisma.notification.count({
      where: { referenceId: orderId, templateId: CONFIRMED_TEMPLATE },
    });

  const confirmedMessagesFor = (orderNumber: string): number =>
    sms.sent.filter(
      (sent) => sent.body.includes(orderNumber) && sent.body.includes(CONFIRMED_SMS_FRAGMENT),
    ).length;

  /** Moves the order's stock hold so it ends `msFromNow` from now (negative: already over). */
  const setHoldEnd = async (orderId: string, msFromNow: number): Promise<void> => {
    await prisma.stockReservation.updateMany({
      where: { referenceType: 'Order', referenceId: orderId },
      data: { expiresAt: new Date(Date.now() + msFromNow) },
    });
  };

  const holdEnd = async (orderId: string): Promise<Date> =>
    (
      await prisma.stockReservation.findFirstOrThrow({
        where: { referenceType: 'Order', referenceId: orderId },
      })
    ).expiresAt;

  beforeAll(async () => {
    if (!(await isTestDatabaseReachable())) {
      throw new Error(DATABASE_UNREACHABLE_MESSAGE);
    }

    suiteLock = await acquireDatabaseSuiteLock();
    applyMigrations();
    prisma = testPrisma();

    const { AppModule } = await import('../src/app.module');
    const { ReservationSweeper: ReservationSweeperClass } =
      await import('../src/modules/order/reservation-sweeper.service');
    const { BkashReconciliationSweeper: ReconciliationSweeperClass } =
      await import('../src/modules/payment/bkash-reconciliation.sweeper');

    // The notification module binds its own SMS gateway, apart from auth's: both are replaced,
    // so the CONFIRMED message an order sends lands in the same recorder.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PaymentTokens.PaymentGateway)
      .useValue(gateway)
      .overrideProvider(AuthTokens.SmsGateway)
      .useValue(sms)
      .overrideProvider(NotificationTokens.SmsGateway)
      .useValue(sms)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await app.listen(0);

    reservationSweeper = app.get(ReservationSweeperClass);
    reconciliationSweeper = app.get(ReconciliationSweeperClass);
  }, 120_000);

  afterAll(async () => {
    try {
      for (const [key, value] of Object.entries(originalPaymentEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      if (prisma) {
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
    gateway.reset();
    sms.reset();

    store = await seedStore(prisma);
    session = await signIn(CUSTOMER_EMAIL);
  });

  describe('paying for an order', () => {
    it('starts a payment, then a success callback confirms the order as paid and sends the CONFIRMED SMS', async () => {
      const order = await placeOrder();
      const total = BigInt(order.totalPoysha);

      const started = await startPayment(order.id);

      expect(started.status).toBe(201);
      expect(started.body).toEqual({
        redirectUrl: 'https://pay.bkash.example/checkout/PAYID-1',
        expiresInSeconds: 900,
      });
      expect(gateway.createCalls).toEqual([
        {
          amountPoysha: total,
          orderNumber: order.orderNumber,
          callbackUrl: 'https://api.e2e.barakahbazaar.test/api/v1/payments/bkash/callback',
          payerReference: order.orderNumber,
        },
      ]);
      const [pending] = await ledger(order.id);
      expect(pending).toMatchObject({
        status: PaymentTransactionStatus.PENDING,
        gatewayReference: 'PAYID-1',
        amountPoysha: total,
      });

      gateway.scriptExecute('PAYID-1', completedOutcome('TRX-1', total, order.orderNumber));
      const landed = await callback('PAYID-1');

      expect(landed.status).toBe(302);
      expect(landed.headers.location).toBe(resultUrl(order.orderNumber, 'paid'));
      expect(gateway.executeCalls).toEqual(['PAYID-1']);
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: PaymentMethod.BKASH,
      });
      const [captured] = await ledger(order.id);
      expect(captured).toMatchObject({
        status: PaymentTransactionStatus.CAPTURED,
        gatewayTransactionId: 'TRX-1',
        amountPoysha: total,
      });
      expect(confirmedMessagesFor(order.orderNumber)).toBe(1);
      expect(sms.latestTo('+8801712345678').body).toBe(
        `অর্ডার ${order.orderNumber} নিশ্চিত হয়েছে।`,
      );
    });

    it('extends the stock hold by the attempt window when a payment starts', async () => {
      const order = await placeOrder();
      await setHoldEnd(order.id, MINUTE_MS);

      await openAttempt(order.id);

      const extended = (await holdEnd(order.id)).getTime();
      expect(extended).toBeGreaterThan(Date.now() + 14 * MINUTE_MS);
      expect(extended).toBeLessThanOrEqual(Date.now() + 15 * MINUTE_MS);
    });
  });

  describe('a payment that does not complete', () => {
    it('answers outcome=failed for a failure callback, leaves the order PLACED, and a second attempt succeeds', async () => {
      const order = await placeOrder();
      const first = await openAttempt(order.id);
      gateway.scriptQuery(first, { kind: 'failed', reason: 'Customer declined' });

      const failed = await callback(first, 'failure');

      expect(failed.status).toBe(302);
      expect(failed.headers.location).toBe(resultUrl(order.orderNumber, 'failed'));
      expect(gateway.executeCalls).toEqual([]);
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.PLACED,
        paymentStatus: PaymentStatus.PENDING,
      });
      expect((await ledger(order.id))[0]).toMatchObject({
        status: PaymentTransactionStatus.FAILED,
        failureReason: 'Customer declined',
      });

      const second = await openAttempt(order.id);
      expect(second).toBe('PAYID-2');
      gateway.scriptExecute(
        second,
        completedOutcome('TRX-2', BigInt(order.totalPoysha), order.orderNumber),
      );
      const paid = await callback(second);

      expect(paid.headers.location).toBe(resultUrl(order.orderNumber, 'paid'));
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      });
    });

    it('answers outcome=cancelled when the customer backs out on the bKash page', async () => {
      const order = await placeOrder();
      const paymentId = await openAttempt(order.id);
      gateway.scriptQuery(paymentId, { kind: 'cancelled', reason: 'Customer cancelled' });

      const landed = await callback(paymentId, 'cancel');

      expect(landed.headers.location).toBe(resultUrl(order.orderNumber, 'cancelled'));
      expect((await ledger(order.id))[0].status).toBe(PaymentTransactionStatus.CANCELLED);
      expect((await orderRow(order.id)).status).toBe(OrderStatus.PLACED);
    });

    it('never takes the browser at its word: status=success while bKash says failed confirms nothing', async () => {
      const order = await placeOrder();
      const paymentId = await openAttempt(order.id);
      gateway.scriptExecute(paymentId, { kind: 'failed', reason: 'Insufficient balance' });

      const landed = await callback(paymentId, 'success');

      expect(landed.headers.location).toBe(resultUrl(order.orderNumber, 'failed'));
      expect(gateway.executeCalls).toEqual([paymentId]);
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.PLACED,
        paymentStatus: PaymentStatus.PENDING,
      });
      expect((await ledger(order.id))[0].status).toBe(PaymentTransactionStatus.FAILED);
      expect(confirmedMessagesFor(order.orderNumber)).toBe(0);
    });

    it('answers outcome=failed for an unknown paymentID and changes nothing', async () => {
      const order = await placeOrder();
      await openAttempt(order.id);

      const landed = await callback('PAYID-NOBODY', 'success');

      expect(landed.status).toBe(302);
      expect(landed.headers.location).toBe(`${RESULT}?outcome=failed`);
      expect(gateway.executeCalls).toEqual([]);
      expect(gateway.queryCalls).toEqual([]);
      expect((await orderRow(order.id)).status).toBe(OrderStatus.PLACED);
      expect((await ledger(order.id)).map((row) => row.status)).toEqual([
        PaymentTransactionStatus.PENDING,
      ]);
    });
  });

  describe('a success callback replayed', () => {
    const expectSettledOnce = async (order: { id: string; orderNumber: string }): Promise<void> => {
      const rows = await ledger(order.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(PaymentTransactionStatus.CAPTURED);
      expect(await confirmedEvents(order.id)).toBe(1);
      expect(await confirmedNotifications(order.id)).toBe(1);
      expect(confirmedMessagesFor(order.orderNumber)).toBe(1);
      expect(gateway.refundCalls).toEqual([]);
    };

    it('gives the same redirect again, with one CAPTURED row, one order event and one SMS', async () => {
      const order = await placeOrder();
      const paymentId = await openAttempt(order.id);
      gateway.scriptExecute(
        paymentId,
        completedOutcome('TRX-4', BigInt(order.totalPoysha), order.orderNumber),
      );

      const first = await callback(paymentId);
      const second = await callback(paymentId);

      expect(first.headers.location).toBe(resultUrl(order.orderNumber, 'paid'));
      expect(second.headers.location).toBe(first.headers.location);
      expect(gateway.executeCalls).toEqual([paymentId]);
      await expectSettledOnce(order);
    });

    it('settles once when the callback is hit twice at the same moment', async () => {
      const order = await placeOrder();
      const paymentId = await openAttempt(order.id);
      gateway.scriptExecute(
        paymentId,
        completedOutcome('TRX-4B', BigInt(order.totalPoysha), order.orderNumber),
      );

      const [first, second] = await Promise.all([callback(paymentId), callback(paymentId)]);

      expect(first.headers.location).toBe(resultUrl(order.orderNumber, 'paid'));
      expect(second.headers.location).toBe(first.headers.location);
      await expectSettledOnce(order);
    });
  });

  describe('money that arrives for an order that can no longer keep it', () => {
    it('refunds a late success on an order the hold sweeper cancelled, and marks it REFUNDED', async () => {
      const order = await placeOrder();
      const total = BigInt(order.totalPoysha);
      const paymentId = await openAttempt(order.id);
      await setHoldEnd(order.id, -MINUTE_MS);

      await reservationSweeper.sweep();
      expect((await orderRow(order.id)).status).toBe(OrderStatus.CANCELLED);

      gateway.scriptExecute(paymentId, completedOutcome('TRX-5', total, order.orderNumber));
      const landed = await callback(paymentId);

      expect(landed.status).toBe(302);
      expect(landed.headers.location).toBe(resultUrl(order.orderNumber, 'failed'));
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.CANCELLED,
        paymentStatus: PaymentStatus.REFUNDED,
      });
      const [charge, refund] = await ledger(order.id);
      expect(charge).toMatchObject({
        direction: PaymentDirection.CHARGE,
        status: PaymentTransactionStatus.CAPTURED,
        gatewayTransactionId: 'TRX-5',
      });
      expect(refund).toMatchObject({
        direction: PaymentDirection.REFUND,
        status: PaymentTransactionStatus.CAPTURED,
        gatewayReference: 'refund:TRX-5',
        gatewayTransactionId: 'REFUND-1',
        amountPoysha: total,
      });
      expect(gateway.refundCalls).toEqual([
        { amountPoysha: total, originalReference: paymentId, transactionId: 'TRX-5' },
      ]);
      expect(confirmedMessagesFor(order.orderNumber)).toBe(0);
    });

    it('lets the reconciliation sweep give the money back when the first refund was refused', async () => {
      const order = await placeOrder();
      const total = BigInt(order.totalPoysha);
      const paymentId = await openAttempt(order.id);
      await setHoldEnd(order.id, -MINUTE_MS);
      await reservationSweeper.sweep();
      gateway.scriptExecute(paymentId, completedOutcome('TRX-5B', total, order.orderNumber));
      gateway.nextRefund(refundRefused('bKash is busy'));

      await callback(paymentId);

      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.CANCELLED,
        paymentStatus: PaymentStatus.PENDING,
      });
      expect((await ledger(order.id)).map((row) => row.direction)).toEqual([
        PaymentDirection.CHARGE,
      ]);

      await reconciliationSweeper.sweep();

      expect(gateway.refundCalls).toHaveLength(2);
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.CANCELLED,
        paymentStatus: PaymentStatus.REFUNDED,
      });
      const refunds = (await ledger(order.id)).filter(
        (row) => row.direction === PaymentDirection.REFUND,
      );
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({
        status: PaymentTransactionStatus.CAPTURED,
        gatewayReference: 'refund:TRX-5B',
      });
    });

    it('switches to cash on delivery with 200, extends the hold, and refunds the old attempt when it later completes', async () => {
      const order = await placeOrder();
      const total = BigInt(order.totalPoysha);
      const paymentId = await openAttempt(order.id);
      await setHoldEnd(order.id, 2 * MINUTE_MS);

      const switched = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${order.id}/payment-method`)
        .set(headers())
        .send({ paymentMethod: 'CASH_ON_DELIVERY' });

      expect(switched.status).toBe(200);
      expect(switched.body).toMatchObject({
        id: order.id,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        status: OrderStatus.PLACED,
      });
      expect((await holdEnd(order.id)).getTime()).toBeGreaterThan(Date.now() + 167 * HOUR_MS);

      gateway.scriptExecute(paymentId, completedOutcome('TRX-6', total, order.orderNumber));
      const landed = await callback(paymentId);

      expect(landed.headers.location).toBe(resultUrl(order.orderNumber, 'failed'));
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.PLACED,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        paymentStatus: PaymentStatus.PENDING,
      });
      const [charge, refund] = await ledger(order.id);
      expect(charge).toMatchObject({
        status: PaymentTransactionStatus.CAPTURED,
        gatewayTransactionId: 'TRX-6',
      });
      expect(refund).toMatchObject({
        direction: PaymentDirection.REFUND,
        status: PaymentTransactionStatus.CAPTURED,
        gatewayReference: 'refund:TRX-6',
        amountPoysha: total,
      });
      expect(gateway.refundCalls).toHaveLength(1);
      expect(confirmedMessagesFor(order.orderNumber)).toBe(0);
    });

    it.each([
      ['amount', (total: bigint, number: string) => completedOutcome('TRX-7A', total + 1n, number)],
      [
        'currency',
        (total: bigint, number: string) => completedOutcome('TRX-7B', total, number, 'USD'),
      ],
      [
        'order number',
        (total: bigint, number: string) => completedOutcome('TRX-7C', total, `${number}-X`),
      ],
    ])(
      'closes the attempt FAILED, without confirming or refunding, when bKash completes a different %s',
      async (_label, outcomeFor) => {
        const order = await placeOrder();
        const paymentId = await openAttempt(order.id);
        gateway.scriptExecute(paymentId, outcomeFor(BigInt(order.totalPoysha), order.orderNumber));

        const landed = await callback(paymentId);

        expect(landed.headers.location).toBe(resultUrl(order.orderNumber, 'failed'));
        expect(await orderRow(order.id)).toMatchObject({
          status: OrderStatus.PLACED,
          paymentStatus: PaymentStatus.PENDING,
        });
        const rows = await ledger(order.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          status: PaymentTransactionStatus.FAILED,
          failureReason: 'bKash completed a different amount or order.',
          gatewayTransactionId: null,
        });
        expect(gateway.refundCalls).toEqual([]);
        expect(confirmedMessagesFor(order.orderNumber)).toBe(0);
      },
    );
  });

  describe('the sweepers', () => {
    it('settles an attempt whose callback never came, once it is old enough to ask about', async () => {
      const order = await placeOrder();
      const paymentId = await openAttempt(order.id);
      gateway.scriptQuery(
        paymentId,
        completedOutcome('TRX-8', BigInt(order.totalPoysha), order.orderNumber),
      );

      await reconciliationSweeper.sweep();
      expect(gateway.queryCalls).toEqual([]);

      await prisma.paymentTransaction.updateMany({
        where: { orderId: order.id },
        data: { createdAt: new Date(Date.now() - 5 * MINUTE_MS) },
      });
      await reconciliationSweeper.sweep();

      expect(gateway.queryCalls).toEqual([paymentId]);
      expect(gateway.executeCalls).toEqual([]);
      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      });
      expect((await ledger(order.id))[0]).toMatchObject({
        status: PaymentTransactionStatus.CAPTURED,
        gatewayTransactionId: 'TRX-8',
      });
      expect(confirmedMessagesFor(order.orderNumber)).toBe(1);
    });

    it('never cancels a PAID order whose hold has run out', async () => {
      const order = await placeOrder();
      const paymentId = await openAttempt(order.id);
      gateway.scriptExecute(
        paymentId,
        completedOutcome('TRX-8B', BigInt(order.totalPoysha), order.orderNumber),
      );
      await callback(paymentId);
      await setHoldEnd(order.id, -MINUTE_MS);

      await reservationSweeper.sweep();

      expect(await orderRow(order.id)).toMatchObject({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      });
    });
  });

  describe('who may pay, and when bKash is off', () => {
    it("answers 404 for another customer's order and never calls bKash", async () => {
      const order = await placeOrder();
      const stranger = await signIn(STRANGER_EMAIL);

      const response = await startPayment(order.id, stranger);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Order not found.');
      expect(gateway.createCalls).toEqual([]);
      expect(await ledger(order.id)).toEqual([]);
    });

    it('answers 503 when PAYMENT_PROVIDER is noop and never calls bKash', async () => {
      const order = await placeOrder();
      const config: { get: (key: string, ...rest: unknown[]) => unknown } = app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = jest
        .spyOn(config, 'get')
        .mockImplementation((key: string, ...rest: unknown[]) =>
          key === 'PAYMENT_PROVIDER' ? 'noop' : realGet(key, ...rest),
        );

      try {
        const response = await startPayment(order.id);

        expect(response.status).toBe(503);
        expect(response.body.message).toBe('bKash payment is not available right now.');
      } finally {
        spy.mockRestore();
      }
      expect(gateway.createCalls).toEqual([]);
      expect(await ledger(order.id)).toEqual([]);
    });
  });
});

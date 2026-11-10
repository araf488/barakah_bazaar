import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  UserRole,
} from '../../infra/prisma/prisma-client';
import { NotificationService } from '../notification/notification.service';
import { OrderRepository } from '../order/order.repository';
import { BkashCheckoutService } from './bkash-checkout.service';
import { PaymentRepository, RefundOwed } from './payment.repository';
import { CheckoutOutcome, PaymentGateway } from './ports/payment-gateway.port';

const customer: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'customer@example.com',
  role: UserRole.CUSTOMER,
};

const NOW = new Date('2026-10-17T10:00:00.000Z');

const order = (overrides = {}) => ({
  id: 'ord-1',
  userId: 'user-1',
  orderNumber: 'BB-20261017-000042',
  status: OrderStatus.PLACED,
  paymentMethod: PaymentMethod.BKASH,
  paymentStatus: PaymentStatus.PENDING,
  totalPoysha: 250000n,
  phone: '+8801712345678',
  recipientName: 'Rahim',
  items: [],
  events: [],
  ...overrides,
});

const attempt = (overrides: Partial<PaymentTransaction> = {}): PaymentTransaction => ({
  id: 'pay-1',
  orderId: 'ord-1',
  method: PaymentMethod.BKASH,
  direction: PaymentDirection.CHARGE,
  status: PaymentTransactionStatus.PENDING,
  amountPoysha: 250000n,
  gatewayReference: 'PAYID-1',
  gatewayTransactionId: null,
  collectedBy: null,
  failureReason: null,
  capturedAt: null,
  createdAt: new Date('2026-10-17T09:58:00.000Z'),
  updatedAt: new Date('2026-10-17T09:58:00.000Z'),
  ...overrides,
});

const capturedCharge = (overrides: Partial<PaymentTransaction> = {}): PaymentTransaction =>
  attempt({
    status: PaymentTransactionStatus.CAPTURED,
    gatewayTransactionId: 'TRX-1',
    capturedAt: new Date('2026-10-17T10:00:00.000Z'),
    ...overrides,
  });

const completed = (overrides = {}): CheckoutOutcome => ({
  kind: 'completed',
  transactionId: 'TRX-1',
  amountPoysha: 250000n,
  currency: 'BDT',
  orderNumber: 'BB-20261017-000042',
  ...overrides,
});

const owed = (overrides: Partial<RefundOwed> = {}): RefundOwed => ({
  orderId: 'ord-1',
  charge: capturedCharge(),
  amountPoysha: 250000n,
  markRefunded: true,
  ...overrides,
});

describe('BkashCheckoutService', () => {
  let payments: {
    createAttempt: jest.Mock;
    findAttemptByPaymentId: jest.Mock;
    findAttemptWithOrderNumber: jest.Mock;
    closeAttempt: jest.Mock;
    captureAttempt: jest.Mock;
    captureMismatched: jest.Mock;
    claimRefund: jest.Mock;
    completeRefund: jest.Mock;
    releaseRefundClaim: jest.Mock;
    findRefundOwedForOrder: jest.Mock;
  };
  /** Refund claims held, by `gateway_reference`: the unique index the repository relies on. */
  let claims: Map<string, PaymentTransaction>;
  let orders: { findForUser: jest.Mock; findById: jest.Mock; holdActive: jest.Mock };
  let gateway: jest.Mocked<PaymentGateway>;
  let notifications: { notifyOrderStatus: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let provider: string;
  let apiBase: string;
  let service: BkashCheckoutService;

  const build = (): BkashCheckoutService =>
    new BkashCheckoutService(
      payments as unknown as PaymentRepository,
      orders as unknown as OrderRepository,
      gateway,
      notifications as unknown as NotificationService,
      createMockConfig({
        PAYMENT_PROVIDER: provider,
        API_PUBLIC_BASE_URL: apiBase,
      }),
      logger,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    payments = {
      createAttempt: jest.fn().mockResolvedValue(attempt()),
      findAttemptByPaymentId: jest.fn(),
      findAttemptWithOrderNumber: jest.fn(),
      closeAttempt: jest.fn().mockResolvedValue(true),
      captureAttempt: jest.fn(),
      captureMismatched: jest.fn(),
      // Stateful like the unique `refund:<trxID>` reference: one claim per charge at a time.
      claimRefund: jest.fn(
        async (orderId: string, charge: PaymentTransaction, amountPoysha: bigint) => {
          await Promise.resolve();
          const reference = `refund:${charge.gatewayTransactionId}`;
          if (claims.has(reference)) {
            return 'claimed';
          }
          const claim = attempt({
            id: `claim-${claims.size + 1}`,
            orderId,
            direction: PaymentDirection.REFUND,
            amountPoysha,
            gatewayReference: reference,
          });
          claims.set(reference, claim);
          return claim;
        },
      ),
      completeRefund: jest.fn().mockResolvedValue(true),
      releaseRefundClaim: jest.fn((claimId: string) => {
        const held = [...claims.entries()].find(([, claim]) => claim.id === claimId);
        if (held) {
          claims.delete(held[0]);
        }
        return Promise.resolve(held !== undefined);
      }),
      findRefundOwedForOrder: jest.fn().mockResolvedValue(owed()),
    };
    claims = new Map();
    orders = {
      findForUser: jest.fn().mockResolvedValue(order()),
      findById: jest.fn().mockResolvedValue(order()),
      holdActive: jest.fn().mockResolvedValue(true),
    };
    gateway = {
      charge: jest.fn(),
      refund: jest.fn().mockResolvedValue({
        ok: true,
        reference: 'RFD-1',
        pending: false,
        failureReason: null,
        ambiguous: false,
      }),
      createCheckout: jest.fn().mockResolvedValue({
        ok: true,
        paymentId: 'PAYID-1',
        redirectUrl: 'https://sandbox.payment.bkash.com/?paymentId=PAYID-1',
      }),
      executeCheckout: jest.fn(),
      queryCheckout: jest.fn(),
    };
    notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    provider = 'bkash';
    apiBase = 'https://api.barakahbazaar.com.bd';
    service = build();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start', () => {
    it('answers the redirect URL and a 900 second window', async () => {
      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: true,
        data: {
          redirectUrl: 'https://sandbox.payment.bkash.com/?paymentId=PAYID-1',
          expiresInSeconds: 900,
        },
      });
    });

    it('loads the order scoped to the signed-in customer', async () => {
      await service.start(customer, 'ord-1');

      expect(orders.findForUser).toHaveBeenCalledWith('user-1', 'ord-1');
      expect(orders.holdActive).toHaveBeenCalledWith('ord-1');
    });

    it('asks bKash for the order total, the order number and the API callback', async () => {
      await service.start(customer, 'ord-1');

      expect(gateway.createCheckout).toHaveBeenCalledWith({
        amountPoysha: 250000n,
        orderNumber: 'BB-20261017-000042',
        callbackUrl: 'https://api.barakahbazaar.com.bd/api/v1/payments/bkash/callback',
        payerReference: 'BB-20261017-000042',
      });
    });

    it.each([
      [
        'https://api.barakahbazaar.com.bd/',
        'https://api.barakahbazaar.com.bd/api/v1/payments/bkash/callback',
      ],
      ['https://x/backend/', 'https://x/backend/api/v1/payments/bkash/callback'],
      ['https://x/backend//', 'https://x/backend/api/v1/payments/bkash/callback'],
    ])('joins the callback to the base %s with exactly one slash', async (base, callbackUrl) => {
      apiBase = base;
      service = build();

      await service.start(customer, 'ord-1');

      expect(gateway.createCheckout.mock.calls[0][0].callbackUrl).toBe(callbackUrl);
    });

    it('opens the attempt with a hold running exactly 15 minutes from now', async () => {
      await service.start(customer, 'ord-1');

      expect(payments.createAttempt).toHaveBeenCalledWith(
        { orderId: 'ord-1', amountPoysha: 250000n, paymentId: 'PAYID-1' },
        new Date('2026-10-17T10:15:00.000Z'),
      );
    });

    it('hands back only the redirect and the window, nothing token-shaped', async () => {
      const result = await service.start(customer, 'ord-1');

      expect(result.ok && Object.keys(result.data)).toEqual(['redirectUrl', 'expiresInSeconds']);
      expect(JSON.stringify(result)).not.toMatch(/token/i);
    });

    it('answers 503 when the order cannot be read', async () => {
      orders.findForUser.mockResolvedValue(null);

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not process the payment. Please try again.',
      });
    });

    it("answers 404 for an order that is missing or someone else's", async () => {
      orders.findForUser.mockResolvedValue(undefined);

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Order not found.',
      });
    });

    it.each([
      [
        'not paid by bKash (checked first)',
        {
          paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.PAID,
        },
        'This order is not paid by bKash.',
      ],
      [
        'no longer PLACED (checked before paid)',
        { status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.PAID },
        'This order can no longer be paid.',
      ],
      ['already paid', { paymentStatus: PaymentStatus.PAID }, 'This order has already been paid.'],
    ])('answers 409 when the order is %s', async (_case, overrides, message) => {
      orders.findForUser.mockResolvedValue(order(overrides));

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message,
      });
      expect(gateway.createCheckout).not.toHaveBeenCalled();
    });

    it('answers 409 when the stock hold has lapsed', async () => {
      orders.holdActive.mockResolvedValue(false);

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'The time to pay for this order has passed.',
      });
      expect(gateway.createCheckout).not.toHaveBeenCalled();
    });

    it('answers 503 rather than 409 when the hold cannot be read', async () => {
      orders.holdActive.mockResolvedValue(null);

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not process the payment. Please try again.',
      });
    });

    it('answers 503 under the noop provider, without calling the gateway', async () => {
      provider = 'noop';
      service = build();

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'bKash payment is not available right now.',
      });
      expect(gateway.createCheckout).not.toHaveBeenCalled();
    });

    it('refuses a lapsed hold with 409 before reporting the noop provider', async () => {
      provider = 'noop';
      service = build();
      orders.holdActive.mockResolvedValue(false);

      await expect(service.start(customer, 'ord-1')).resolves.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
    });

    it('answers 502 when bKash refuses to create the payment, and opens no attempt', async () => {
      gateway.createCheckout.mockResolvedValue({ ok: false, failureReason: 'bKash said no' });

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.BAD_GATEWAY,
        message: 'bKash could not start the payment. Please try again.',
      });
      expect(payments.createAttempt).not.toHaveBeenCalled();
    });

    it('answers 502 when bKash hands back a paymentID already recorded', async () => {
      payments.createAttempt.mockResolvedValue('duplicate');

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.BAD_GATEWAY,
        message: 'bKash could not start the payment. Please try again.',
      });
    });

    it('answers 503 when the attempt cannot be written', async () => {
      payments.createAttempt.mockResolvedValue(null);

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not process the payment. Please try again.',
      });
    });

    it('answers 500 and logs when something throws', async () => {
      orders.findForUser.mockRejectedValue(new Error('boom'));

      await expect(service.start(customer, 'ord-1')).resolves.toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'Exception occurred in BkashCheckoutService.start',
      );
    });
  });

  describe('settle — outcomes that move no money', () => {
    it.each([[{ kind: 'pending' } as const], [{ kind: 'error', reason: 'timeout' } as const]])(
      'leaves the attempt PENDING on %j',
      async (outcome) => {
        await expect(service.settle(attempt(), outcome)).resolves.toBe('pending');
        expect(payments.closeAttempt).not.toHaveBeenCalled();
        expect(payments.captureAttempt).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['failed', PaymentTransactionStatus.FAILED, 'failed'],
      ['expired', PaymentTransactionStatus.FAILED, 'failed'],
      ['cancelled', PaymentTransactionStatus.CANCELLED, 'cancelled'],
    ] as const)('closes a %s attempt as %s', async (kind, status, result) => {
      await expect(service.settle(attempt(), { kind, reason: 'bKash reason' })).resolves.toBe(
        result,
      );
      expect(payments.closeAttempt).toHaveBeenCalledWith('pay-1', status, 'bKash reason');
      expect(orders.findById).not.toHaveBeenCalled();
    });

    it('answers what the attempt became when someone else settled it first', async () => {
      payments.closeAttempt.mockResolvedValue(false);
      payments.findAttemptByPaymentId.mockResolvedValue(capturedCharge());
      orders.findById.mockResolvedValue(
        order({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID }),
      );

      await expect(service.settle(attempt(), { kind: 'failed', reason: 'late' })).resolves.toBe(
        'paid',
      );
      expect(payments.findAttemptByPaymentId).toHaveBeenCalledWith('PAYID-1');
    });

    it('answers null when the close cannot be written', async () => {
      payments.closeAttempt.mockResolvedValue(null);

      await expect(
        service.settle(attempt(), { kind: 'cancelled', reason: 'x' }),
      ).resolves.toBeNull();
    });
  });

  describe('settle — completed', () => {
    describe('a completed payment that does not match its attempt (ruling R19)', () => {
      const mismatches = [
        ['amount', { amountPoysha: 249999n }, 249999n],
        ['currency', { currency: 'USD' }, 250000n],
        ['order number', { orderNumber: 'BB-20261017-000043' }, 250000n],
      ] as const;

      beforeEach(() => {
        payments.captureMismatched.mockResolvedValue(true);
      });

      it.each(mismatches)(
        'captures what bKash reported when the %s differs, never confirms, and refunds it',
        async (_field, overrides, reported) => {
          const mismatched = capturedCharge({
            amountPoysha: reported,
            failureReason: 'bKash completed a different amount or order.',
          });
          payments.findRefundOwedForOrder.mockResolvedValue(
            owed({ charge: mismatched, amountPoysha: reported, markRefunded: false }),
          );

          await expect(service.settle(attempt(), completed(overrides))).resolves.toBe('refunded');

          expect(payments.captureMismatched).toHaveBeenCalledWith('pay-1', 'TRX-1', reported);
          expect(payments.captureAttempt).not.toHaveBeenCalled();
          expect(payments.closeAttempt).not.toHaveBeenCalled();
          expect(payments.findRefundOwedForOrder).toHaveBeenCalledWith('ord-1');
          expect(payments.claimRefund).toHaveBeenCalledWith('ord-1', mismatched, reported);
          expect(gateway.refund).toHaveBeenCalledWith({
            amountPoysha: reported,
            originalReference: 'PAYID-1',
            transactionId: 'TRX-1',
          });
          expect(payments.completeRefund).toHaveBeenCalledWith('claim-1', 'RFD-1', false);
          expect(notifications.notifyOrderStatus).not.toHaveBeenCalled();
        },
      );

      it('keeps the error log, with the ids and never the amounts', async () => {
        await service.settle(attempt(), completed({ amountPoysha: 249999n }));

        expect(logger.error).toHaveBeenCalledWith(
          { attemptId: 'pay-1', orderId: 'ord-1', transactionId: 'TRX-1' },
          'bKash completed a payment that does not match its attempt',
        );
      });

      it('answers what the attempt became when someone else settled it first, refunding nothing', async () => {
        payments.captureMismatched.mockResolvedValue(false);
        payments.findAttemptByPaymentId.mockResolvedValue(
          attempt({ status: PaymentTransactionStatus.FAILED }),
        );

        await expect(service.settle(attempt(), completed({ currency: 'USD' }))).resolves.toBe(
          'failed',
        );
        expect(payments.captureMismatched).toHaveBeenCalledWith('pay-1', 'TRX-1', 250000n);
        expect(payments.findRefundOwedForOrder).not.toHaveBeenCalled();
        expect(gateway.refund).not.toHaveBeenCalled();
      });

      it('decides nothing when the capture cannot be written', async () => {
        payments.captureMismatched.mockResolvedValue(null);

        await expect(service.settle(attempt(), completed({ currency: 'USD' }))).resolves.toBeNull();
        expect(gateway.refund).not.toHaveBeenCalled();
      });
    });

    it('captures a matching payment and sends the CONFIRMED message exactly once', async () => {
      const confirmed = order({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID });
      payments.captureAttempt.mockResolvedValue({ kind: 'confirmed', order: confirmed });

      await expect(service.settle(attempt(), completed())).resolves.toBe('paid');

      expect(orders.findById).toHaveBeenCalledWith('ord-1');
      expect(payments.captureAttempt).toHaveBeenCalledWith('pay-1', 'TRX-1');
      expect(notifications.notifyOrderStatus).toHaveBeenCalledTimes(1);
      expect(notifications.notifyOrderStatus).toHaveBeenCalledWith(OrderStatus.CONFIRMED, {
        userId: 'user-1',
        phone: '+8801712345678',
        orderId: 'ord-1',
        orderNumber: 'BB-20261017-000042',
        recipientName: 'Rahim',
        totalPoysha: 250000n,
      });
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('still answers paid when the message cannot be sent', async () => {
      payments.captureAttempt.mockResolvedValue({
        kind: 'confirmed',
        order: order({ status: OrderStatus.CONFIRMED }),
      });
      notifications.notifyOrderStatus.mockRejectedValue(new Error('sms down'));

      await expect(service.settle(attempt(), completed())).resolves.toBe('paid');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'bKash payment captured but could not be announced',
      );
    });

    it('refunds a capture the order cannot take by its trxID and records the refund', async () => {
      payments.captureAttempt.mockResolvedValue({ kind: 'refund-due', orderId: 'ord-1' });

      await expect(service.settle(attempt(), completed())).resolves.toBe('refunded');

      expect(payments.findRefundOwedForOrder).toHaveBeenCalledWith('ord-1');
      expect(gateway.refund).toHaveBeenCalledWith({
        amountPoysha: 250000n,
        originalReference: 'PAYID-1',
        transactionId: 'TRX-1',
      });
      expect(payments.claimRefund).toHaveBeenCalledWith('ord-1', capturedCharge(), 250000n);
      expect(payments.completeRefund).toHaveBeenCalledWith('claim-1', 'RFD-1', true);
      expect(notifications.notifyOrderStatus).not.toHaveBeenCalled();
    });

    it('logs a refused automatic refund, records nothing, and does not throw', async () => {
      payments.captureAttempt.mockResolvedValue({ kind: 'refund-due', orderId: 'ord-1' });
      gateway.refund.mockResolvedValue({
        ok: false,
        reference: null,
        pending: false,
        failureReason: 'bKash refused',
        ambiguous: false,
      });

      await expect(service.settle(attempt(), completed())).resolves.toBe('refunded');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1', chargeId: 'pay-1' }),
        'bKash automatic refund failed',
      );
      expect(payments.completeRefund).not.toHaveBeenCalled();
    });

    it('leaves the refund to the sweeper when the owed read fails', async () => {
      payments.captureAttempt.mockResolvedValue({ kind: 'refund-due', orderId: 'ord-1' });
      payments.findRefundOwedForOrder.mockResolvedValue(null);

      await expect(service.settle(attempt(), completed())).resolves.toBe('refunded');
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('calls no refund when the order turns out to be owed nothing', async () => {
      payments.captureAttempt.mockResolvedValue({ kind: 'refund-due', orderId: 'ord-1' });
      payments.findRefundOwedForOrder.mockResolvedValue(undefined);

      await expect(service.settle(attempt(), completed())).resolves.toBe('refunded');
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('keeps a late success on a CANCELLED order refunded in full and marks it REFUNDED', async () => {
      orders.findById.mockResolvedValue(order({ status: OrderStatus.CANCELLED }));
      payments.captureAttempt.mockResolvedValue({ kind: 'refund-due', orderId: 'ord-1' });
      payments.findRefundOwedForOrder.mockResolvedValue(owed({ markRefunded: true }));

      await expect(service.settle(attempt(), completed())).resolves.toBe('refunded');

      expect(payments.claimRefund).toHaveBeenCalledWith('ord-1', capturedCharge(), 250000n);
      expect(payments.completeRefund).toHaveBeenCalledWith('claim-1', 'RFD-1', true);
    });

    it('answers what the attempt became when it was already settled', async () => {
      payments.captureAttempt.mockResolvedValue({ kind: 'already-settled' });
      payments.findAttemptByPaymentId.mockResolvedValue(
        attempt({ status: PaymentTransactionStatus.FAILED }),
      );

      await expect(service.settle(attempt(), completed())).resolves.toBe('failed');
      expect(notifications.notifyOrderStatus).not.toHaveBeenCalled();
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('answers null, capturing nothing, when the order cannot be read', async () => {
      orders.findById.mockResolvedValue(null);

      await expect(service.settle(attempt(), completed())).resolves.toBeNull();
      expect(payments.captureAttempt).not.toHaveBeenCalled();
    });

    it('answers null when the capture cannot be written', async () => {
      payments.captureAttempt.mockResolvedValue(null);

      await expect(service.settle(attempt(), completed())).resolves.toBeNull();
      expect(notifications.notifyOrderStatus).not.toHaveBeenCalled();
    });

    it('answers null and logs when something throws', async () => {
      orders.findById.mockRejectedValue(new Error('boom'));

      await expect(service.settle(attempt(), completed())).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ attemptId: 'pay-1' }),
        'Exception occurred in BkashCheckoutService.settle',
      );
    });
  });

  describe('settle — a callback hit twice at once', () => {
    it('captures once, sends one message, and answers paid to both', async () => {
      let status: PaymentTransactionStatus = PaymentTransactionStatus.PENDING;
      const currentOrder = () =>
        status === PaymentTransactionStatus.CAPTURED
          ? order({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID })
          : order();

      orders.findById.mockImplementation(() => Promise.resolve(currentOrder()));
      payments.findAttemptByPaymentId.mockImplementation(() =>
        Promise.resolve(capturedCharge({ status })),
      );
      // The conditional PENDING → CAPTURED update: only the first caller gets past it.
      payments.captureAttempt.mockImplementation(async () => {
        await Promise.resolve();
        if (status !== PaymentTransactionStatus.PENDING) {
          return { kind: 'already-settled' };
        }
        status = PaymentTransactionStatus.CAPTURED;
        return { kind: 'confirmed', order: currentOrder() };
      });

      const results = await Promise.all([
        service.settle(attempt(), completed()),
        service.settle(attempt(), completed()),
      ]);

      expect(results).toEqual(['paid', 'paid']);
      expect(payments.captureAttempt).toHaveBeenCalledTimes(2);
      expect(notifications.notifyOrderStatus).toHaveBeenCalledTimes(1);
      expect(gateway.refund).not.toHaveBeenCalled();
    });
  });

  describe('handleCallback', () => {
    const ORDER_NUMBER = 'BB-20261017-000042';
    const found = (overrides: Partial<PaymentTransaction> = {}) => ({
      attempt: attempt(overrides),
      orderNumber: ORDER_NUMBER,
    });

    beforeEach(() => {
      payments.findAttemptWithOrderNumber.mockResolvedValue(found());
    });

    it.each([
      ['an unknown paymentID', undefined],
      ['a failed lookup', null],
    ])('answers failed with no order for %s, calling nothing else', async (_label, lookup) => {
      payments.findAttemptWithOrderNumber.mockResolvedValue(lookup);

      await expect(service.handleCallback('PAYID-X', 'success')).resolves.toEqual({
        outcome: 'failed',
        orderNumber: null,
      });
      expect(gateway.executeCheckout).not.toHaveBeenCalled();
      expect(gateway.queryCheckout).not.toHaveBeenCalled();
      expect(payments.captureAttempt).not.toHaveBeenCalled();
    });

    it('looks the attempt up by the paymentID it was given', async () => {
      gateway.executeCheckout.mockResolvedValue({ kind: 'pending' });
      payments.findAttemptByPaymentId.mockResolvedValue(attempt());

      await service.handleCallback('PAYID-1', 'success');

      expect(payments.findAttemptWithOrderNumber).toHaveBeenCalledWith('PAYID-1');
    });

    it('executes the payment on status=success and answers paid once captured', async () => {
      gateway.executeCheckout.mockResolvedValue(completed());
      orders.findById.mockResolvedValue(order());
      payments.captureAttempt.mockResolvedValue({
        kind: 'confirmed',
        order: order({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID }),
      });

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: 'paid',
        orderNumber: ORDER_NUMBER,
      });
      expect(gateway.executeCheckout).toHaveBeenCalledWith('PAYID-1');
      expect(gateway.queryCheckout).not.toHaveBeenCalled();
      expect(payments.captureAttempt).toHaveBeenCalledWith('pay-1', 'TRX-1');
    });

    it.each(['cancel', 'failure', 'SUCCESS', 'success&outcome=paid', undefined])(
      'only reads from bKash for status %s, never executes',
      async (status) => {
        gateway.queryCheckout.mockResolvedValue({
          kind: 'cancelled',
          reason: 'customer cancelled',
        });

        await expect(service.handleCallback('PAYID-1', status)).resolves.toEqual({
          outcome: 'cancelled',
          orderNumber: ORDER_NUMBER,
        });
        expect(gateway.queryCheckout).toHaveBeenCalledWith('PAYID-1');
        expect(gateway.executeCheckout).not.toHaveBeenCalled();
      },
    );

    it('never captures a status=success callback unless bKash itself said completed', async () => {
      gateway.executeCheckout.mockResolvedValue({ kind: 'failed', reason: 'declined' });
      payments.findAttemptByPaymentId.mockResolvedValue(attempt());

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: 'failed',
        orderNumber: ORDER_NUMBER,
      });
      expect(payments.captureAttempt).not.toHaveBeenCalled();
      expect(payments.closeAttempt).toHaveBeenCalledWith('pay-1', 'FAILED', 'declined');
    });

    it.each([
      [PaymentTransactionStatus.FAILED, 'failed'],
      [PaymentTransactionStatus.CANCELLED, 'cancelled'],
    ])(
      'answers a terminal %s attempt from the ledger without calling bKash',
      async (status, word) => {
        payments.findAttemptWithOrderNumber.mockResolvedValue(found({ status }));

        await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
          outcome: word,
          orderNumber: ORDER_NUMBER,
        });
        expect(gateway.executeCheckout).not.toHaveBeenCalled();
        expect(gateway.queryCheckout).not.toHaveBeenCalled();
      },
    );

    it.each([
      [{ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID }, 'paid'],
      [{ status: OrderStatus.CANCELLED }, 'failed'],
    ])('reads a captured attempt through its order (%o) as %s', async (overrides, word) => {
      payments.findAttemptWithOrderNumber.mockResolvedValue(
        found({ status: PaymentTransactionStatus.CAPTURED }),
      );
      orders.findById.mockResolvedValue(order(overrides));

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: word,
        orderNumber: ORDER_NUMBER,
      });
      expect(gateway.executeCheckout).not.toHaveBeenCalled();
    });

    it('tells the customer failed, not refunded, when the capture had to be given back', async () => {
      gateway.executeCheckout.mockResolvedValue(completed());
      orders.findById.mockResolvedValue(order({ status: OrderStatus.CANCELLED }));
      payments.captureAttempt.mockResolvedValue({ kind: 'refund-due', orderId: 'ord-1' });

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: 'failed',
        orderNumber: ORDER_NUMBER,
      });
    });

    it('answers pending, keeping the order, when a terminal attempt cannot be read back', async () => {
      payments.findAttemptWithOrderNumber.mockResolvedValue(
        found({ status: PaymentTransactionStatus.CAPTURED }),
      );
      orders.findById.mockResolvedValue(null);

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: 'pending',
        orderNumber: ORDER_NUMBER,
      });
    });

    it('answers pending, keeping the order, when settling could not decide', async () => {
      gateway.executeCheckout.mockResolvedValue(completed());
      orders.findById.mockResolvedValue(null);

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: 'pending',
        orderNumber: ORDER_NUMBER,
      });
    });

    it('answers pending, keeping the order, when bKash cannot be reached after the attempt is found', async () => {
      gateway.executeCheckout.mockRejectedValue(new Error('network down'));

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: 'pending',
        orderNumber: ORDER_NUMBER,
      });
      expect(payments.captureAttempt).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), attemptId: 'pay-1' },
        'Exception occurred in BkashCheckoutService.handleCallback while settling',
      );
    });

    it('answers failed with no order, never throws, when even the lookup throws', async () => {
      payments.findAttemptWithOrderNumber.mockRejectedValue(new Error('boom'));

      await expect(service.handleCallback('PAYID-1', 'success')).resolves.toEqual({
        outcome: 'failed',
        orderNumber: null,
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('answers pending while bKash still has not decided and the ledger agrees', async () => {
      gateway.queryCheckout.mockResolvedValue({ kind: 'pending' });
      payments.findAttemptByPaymentId.mockResolvedValue(attempt());

      await expect(service.handleCallback('PAYID-1', 'cancel')).resolves.toEqual({
        outcome: 'pending',
        orderNumber: ORDER_NUMBER,
      });
    });

    it('answers paid to both of two simultaneous success callbacks, though bKash refuses the second execute', async () => {
      let status: PaymentTransactionStatus = PaymentTransactionStatus.PENDING;
      const currentOrder = () =>
        status === PaymentTransactionStatus.CAPTURED
          ? order({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID })
          : order();
      let executes = 0;
      let firstCommitted: () => void = () => undefined;
      const committed = new Promise<void>((resolve) => {
        firstCommitted = resolve;
      });

      orders.findById.mockImplementation(() => Promise.resolve(currentOrder()));
      // Both callbacks read the attempt before either one executes.
      payments.findAttemptWithOrderNumber.mockImplementation(() =>
        Promise.resolve({ attempt: attempt(), orderNumber: ORDER_NUMBER }),
      );
      payments.findAttemptByPaymentId.mockImplementation(() =>
        Promise.resolve(capturedCharge({ status })),
      );
      // bKash executes a payment once: the first call completes it, the second is refused. The
      // refusal reaches us after the first callback's capture is committed, so the ledger
      // already shows the payment by the time the second callback looks again.
      gateway.executeCheckout.mockImplementation(async () => {
        await Promise.resolve();
        executes += 1;
        if (executes === 1) {
          return completed();
        }
        await committed;
        return { kind: 'error', reason: 'already executed' };
      });
      payments.captureAttempt.mockImplementation(async () => {
        await Promise.resolve();
        if (status !== PaymentTransactionStatus.PENDING) {
          return { kind: 'already-settled' };
        }
        status = PaymentTransactionStatus.CAPTURED;
        firstCommitted();
        return { kind: 'confirmed', order: currentOrder() };
      });

      const results = await Promise.all([
        service.handleCallback('PAYID-1', 'success'),
        service.handleCallback('PAYID-1', 'success'),
      ]);

      expect(results).toEqual([
        { outcome: 'paid', orderNumber: ORDER_NUMBER },
        { outcome: 'paid', orderNumber: ORDER_NUMBER },
      ]);
      expect(gateway.executeCheckout).toHaveBeenCalledTimes(2);
      expect(payments.captureAttempt).toHaveBeenCalledTimes(1);
      expect(notifications.notifyOrderStatus).toHaveBeenCalledTimes(1);
      expect(gateway.refund).not.toHaveBeenCalled();
    });
  });

  describe('resultOf', () => {
    it.each([
      [PaymentTransactionStatus.PENDING, 'pending'],
      [PaymentTransactionStatus.FAILED, 'failed'],
      [PaymentTransactionStatus.CANCELLED, 'cancelled'],
    ])('reads a %s attempt as %s without touching the order', async (status, result) => {
      await expect(service.resultOf(attempt({ status }))).resolves.toBe(result);
      expect(orders.findById).not.toHaveBeenCalled();
    });

    it('reads a capture the order kept as paid', async () => {
      orders.findById.mockResolvedValue(
        order({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID }),
      );

      await expect(service.resultOf(capturedCharge())).resolves.toBe('paid');
    });

    it.each([
      ['was cancelled', { status: OrderStatus.CANCELLED }],
      ['switched to cash', { paymentMethod: PaymentMethod.CASH_ON_DELIVERY }],
      ['was never paid', { paymentStatus: PaymentStatus.PENDING }],
    ])('reads a capture as refunded when the order %s', async (_case, overrides) => {
      orders.findById.mockResolvedValue(order(overrides));

      await expect(service.resultOf(capturedCharge())).resolves.toBe('refunded');
    });

    it('answers null when the order cannot be read', async () => {
      orders.findById.mockResolvedValue(null);

      await expect(service.resultOf(capturedCharge())).resolves.toBeNull();
    });
  });

  describe('refundNow', () => {
    const rejected = (ambiguous: boolean) => ({
      ok: false,
      reference: null,
      pending: false,
      failureReason: 'bKash refused',
      ambiguous,
    });

    it("claims, refunds the entry's amount by trxID, then completes the claim", async () => {
      await expect(service.refundNow(owed())).resolves.toBe(true);

      expect(payments.claimRefund).toHaveBeenCalledWith('ord-1', capturedCharge(), 250000n);
      expect(gateway.refund).toHaveBeenCalledWith({
        amountPoysha: 250000n,
        originalReference: 'PAYID-1',
        transactionId: 'TRX-1',
      });
      expect(payments.completeRefund).toHaveBeenCalledWith('claim-1', 'RFD-1', true);
      expect(payments.claimRefund.mock.invocationCallOrder[0]).toBeLessThan(
        gateway.refund.mock.invocationCallOrder[0],
      );
    });

    it('gives back only what is owed when that is less than the charge', async () => {
      await service.refundNow(owed({ amountPoysha: 150000n, markRefunded: false }));

      expect(payments.claimRefund).toHaveBeenCalledWith('ord-1', capturedCharge(), 150000n);
      expect(gateway.refund.mock.calls[0][0].amountPoysha).toBe(150000n);
      expect(payments.completeRefund).toHaveBeenCalledWith('claim-1', 'RFD-1', false);
    });

    it('completes a refund bKash finished without naming its own trxID', async () => {
      gateway.refund.mockResolvedValue({
        ok: true,
        reference: null,
        pending: false,
        failureReason: null,
        ambiguous: false,
      });

      await expect(service.refundNow(owed())).resolves.toBe(true);
      expect(payments.completeRefund).toHaveBeenCalledWith('claim-1', null, true);
    });

    it('calls bKash exactly once when two passes refund the same charge at once', async () => {
      const results = await Promise.all([service.refundNow(owed()), service.refundNow(owed())]);

      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(results.sort((a, b) => Number(a) - Number(b))).toEqual([false, true]);
      expect(payments.completeRefund).toHaveBeenCalledTimes(1);
    });

    it('stops without calling bKash when another pass holds the claim', async () => {
      payments.claimRefund.mockResolvedValue('claimed');

      await expect(service.refundNow(owed())).resolves.toBe(false);
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('stops without calling bKash when the claim cannot be written', async () => {
      payments.claimRefund.mockResolvedValue(null);

      await expect(service.refundNow(owed())).resolves.toBe(false);
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { orderId: 'ord-1', chargeId: 'pay-1' },
        'bKash automatic refund could not be claimed',
      );
    });

    it('releases the claim and logs when bKash definitively refuses, so a later pass may retry', async () => {
      gateway.refund.mockResolvedValue(rejected(false));

      await expect(service.refundNow(owed())).resolves.toBe(false);
      expect(payments.releaseRefundClaim).toHaveBeenCalledWith('claim-1');
      expect(logger.error).toHaveBeenCalledWith(
        { orderId: 'ord-1', chargeId: 'pay-1', failureReason: 'bKash refused', released: true },
        'bKash automatic refund failed',
      );
      expect(payments.completeRefund).not.toHaveBeenCalled();

      gateway.refund.mockResolvedValue(rejected(false));
      await service.refundNow(owed());
      expect(gateway.refund).toHaveBeenCalledTimes(2);
    });

    it('keeps the claim when the outcome is unknown, so nothing retries it blindly', async () => {
      gateway.refund.mockResolvedValue(rejected(true));

      await expect(service.refundNow(owed())).resolves.toBe(false);
      expect(payments.releaseRefundClaim).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { orderId: 'ord-1', chargeId: 'pay-1', claimId: 'claim-1', failureReason: 'bKash refused' },
        'bKash refund outcome unknown; claim left for reconciliation',
      );

      await service.refundNow(owed());
      expect(gateway.refund).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['answers false', false],
      ['fails', null],
    ])(
      'keeps the claim and logs when bKash refunded but completing it %s',
      async (_case, completion) => {
        payments.completeRefund.mockResolvedValue(completion);

        await expect(service.refundNow(owed())).resolves.toBe(false);
        expect(payments.releaseRefundClaim).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
          { orderId: 'ord-1', chargeId: 'pay-1', claimId: 'claim-1' },
          'bKash refund succeeded but could not be recorded',
        );

        await service.refundNow(owed());
        expect(gateway.refund).toHaveBeenCalledTimes(1);
      },
    );

    it('never calls bKash for a charge with no paymentID', async () => {
      await expect(
        service.refundNow(owed({ charge: capturedCharge({ gatewayReference: null }) })),
      ).resolves.toBe(false);

      expect(payments.claimRefund).not.toHaveBeenCalled();
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { orderId: 'ord-1', chargeId: 'pay-1' },
        'bKash charge has no payment reference to refund',
      );
    });

    it('never throws, and keeps the claim, even when the gateway does', async () => {
      gateway.refund.mockRejectedValue(new Error('socket hang up'));

      await expect(service.refundNow(owed())).resolves.toBe(false);
      expect(payments.releaseRefundClaim).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'ord-1' }),
        'Exception occurred in BkashCheckoutService.refundNow',
      );
    });
  });
});

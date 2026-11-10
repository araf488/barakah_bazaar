import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  OrderStatus,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
  UserRole,
} from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { OrderRepository } from '../order/order.repository';
import { PaymentGateway } from './ports/payment-gateway.port';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';

const staff: AuthenticatedUser = {
  userId: 'sub-1',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.OPS,
};

const order = (overrides = {}) => ({
  id: 'ord-1',
  orderNumber: 'BB-20260830-000042',
  status: OrderStatus.DELIVERED,
  paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
  paymentStatus: PaymentStatus.PENDING,
  totalPoysha: 250000n,
  phone: '+8801711111111',
  ...overrides,
});

const paymentRow = (overrides = {}) => ({
  id: 'pay-1',
  orderId: 'ord-1',
  method: PaymentMethod.CASH_ON_DELIVERY,
  direction: PaymentDirection.CHARGE,
  status: PaymentTransactionStatus.CAPTURED,
  amountPoysha: 250000n,
  gatewayReference: null,
  gatewayTransactionId: null,
  collectedBy: 'user-1',
  failureReason: null,
  capturedAt: new Date('2026-08-31T00:00:00.000Z'),
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  ...overrides,
});

describe('PaymentService', () => {
  let repository: {
    settle: jest.Mock;
    totalsForOrder: jest.Mock;
    findForOrder: jest.Mock;
    findPage: jest.Mock;
    findByReference: jest.Mock;
    sumPendingRefundClaims: jest.Mock;
    findById: jest.Mock;
    findOwedForOrder: jest.Mock;
    completeRefund: jest.Mock;
    releaseRefundClaim: jest.Mock;
  };
  let orders: { findById: jest.Mock };
  let authService: { resolveActiveUserId: jest.Mock };
  let gateway: jest.Mocked<PaymentGateway>;
  let logger: jest.Mocked<PinoLogger>;
  let service: PaymentService;

  beforeEach(() => {
    repository = {
      settle: jest.fn().mockResolvedValue(paymentRow()),
      totalsForOrder: jest.fn().mockResolvedValue({ capturedPoysha: 0n, refundedPoysha: 0n }),
      findForOrder: jest.fn().mockResolvedValue([]),
      findPage: jest.fn(),
      findByReference: jest.fn(),
      sumPendingRefundClaims: jest.fn().mockResolvedValue(0n),
      findById: jest.fn(),
      findOwedForOrder: jest.fn(),
      completeRefund: jest.fn().mockResolvedValue(true),
      releaseRefundClaim: jest.fn().mockResolvedValue(true),
    };
    orders = { findById: jest.fn().mockResolvedValue(order()) };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    gateway = {
      charge: jest.fn(),
      refund: jest.fn(),
      createCheckout: jest.fn(),
      executeCheckout: jest.fn(),
      queryCheckout: jest.fn(),
    };
    logger = createMockLogger();
    service = new PaymentService(
      repository as unknown as PaymentRepository,
      orders as unknown as OrderRepository,
      authService as unknown as AuthService,
      gateway,
      logger,
    );
  });

  describe('collectCash', () => {
    it('records the full balance and marks the order paid', async () => {
      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result.ok).toBe(true);
      expect(repository.settle).toHaveBeenCalledWith(
        {
          orderId: 'ord-1',
          method: PaymentMethod.CASH_ON_DELIVERY,
          direction: PaymentDirection.CHARGE,
          status: PaymentTransactionStatus.CAPTURED,
          amountPoysha: 250000n,
          gatewayReference: null,
          collectedBy: 'user-1',
          failureReason: null,
        },
        PaymentStatus.PAID,
      );
    });

    it('names the staff member who took the notes', async () => {
      authService.resolveActiveUserId.mockResolvedValue({ ok: true, data: 'rider-9' });

      await service.collectCash(staff, 'ord-1', {});

      expect(repository.settle.mock.calls[0][0].collectedBy).toBe('rider-9');
    });

    it('leaves the order PENDING on a part payment, so the balance stays visible', async () => {
      await service.collectCash(staff, 'ord-1', { amountPoysha: 100000 });

      expect(repository.settle).toHaveBeenCalledWith(
        expect.objectContaining({ amountPoysha: 100000n }),
        null,
      );
    });

    it('marks the order paid once a second part payment clears the balance', async () => {
      repository.totalsForOrder.mockResolvedValue({
        capturedPoysha: 150000n,
        refundedPoysha: 0n,
      });

      await service.collectCash(staff, 'ord-1', { amountPoysha: 100000 });

      expect(repository.settle).toHaveBeenCalledWith(
        expect.objectContaining({ amountPoysha: 100000n }),
        PaymentStatus.PAID,
      );
    });

    it('allows collection while the order is still out for delivery', async () => {
      orders.findById.mockResolvedValue(order({ status: OrderStatus.DISPATCHED }));

      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result.ok).toBe(true);
    });

    it('refuses cash before the order has left the warehouse', async () => {
      orders.findById.mockResolvedValue(order({ status: OrderStatus.PICKING }));

      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'Cash can only be collected on an order that is out for delivery or delivered.',
      });
      expect(repository.settle).not.toHaveBeenCalled();
    });

    it('refuses cash on an order that is not paid by cash', async () => {
      orders.findById.mockResolvedValue(order({ paymentMethod: PaymentMethod.BKASH }));

      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This order is not paid by cash on delivery.',
      });
    });

    it('refuses a second collection on an order already settled', async () => {
      repository.totalsForOrder.mockResolvedValue({
        capturedPoysha: 250000n,
        refundedPoysha: 0n,
      });

      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This order has already been paid.',
      });
    });

    it('refuses more cash than the order is worth', async () => {
      const result = await service.collectCash(staff, 'ord-1', { amountPoysha: 999999 });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'The amount does not match the order total.',
      });
      expect(repository.settle).not.toHaveBeenCalled();
    });

    it('reports 404 for an order that does not exist', async () => {
      orders.findById.mockResolvedValue(undefined);

      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Order not found.',
      });
    });

    it('reports 503 rather than 404 when the order cannot be read', async () => {
      orders.findById.mockResolvedValue(null);

      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not process the payment. Please try again.',
      });
    });

    it('reports 503 when the money row could not be written', async () => {
      repository.settle.mockResolvedValue(null);

      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('refund', () => {
    beforeEach(() => {
      repository.totalsForOrder.mockResolvedValue({
        capturedPoysha: 250000n,
        refundedPoysha: 0n,
      });
    });

    it('records a refund as its own row rather than mutating the charge', async () => {
      await service.refund(staff, 'ord-1', {});

      expect(repository.settle).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: PaymentDirection.REFUND,
          status: PaymentTransactionStatus.CAPTURED,
          amountPoysha: 250000n,
        }),
        PaymentStatus.REFUNDED,
      );
    });

    it('leaves the order PAID on a partial refund, because most of the money is still ours', async () => {
      await service.refund(staff, 'ord-1', { amountPoysha: 50000 });

      expect(repository.settle).toHaveBeenCalledWith(
        expect.objectContaining({ amountPoysha: 50000n }),
        null,
      );
    });

    it('refuses a refund on an order that never took any money', async () => {
      repository.totalsForOrder.mockResolvedValue({ capturedPoysha: 0n, refundedPoysha: 0n });

      const result = await service.refund(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This order has no captured payment to refund.',
      });
    });

    it('refuses to give back more than was taken', async () => {
      const result = await service.refund(staff, 'ord-1', { amountPoysha: 300000 });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'A refund cannot exceed the amount captured.',
      });
    });

    it('accounts for money already given back', async () => {
      repository.totalsForOrder.mockResolvedValue({
        capturedPoysha: 250000n,
        refundedPoysha: 200000n,
      });

      const result = await service.refund(staff, 'ord-1', { amountPoysha: 100000 });

      expect(result.ok).toBe(false);
    });

    describe('while an automatic bKash refund is in flight', () => {
      // The order keeps charge A; charge B's automatic refund is claimed but not completed.
      beforeEach(() => {
        orders.findById.mockResolvedValue(
          order({ paymentMethod: PaymentMethod.BKASH, status: OrderStatus.CONFIRMED }),
        );
        repository.totalsForOrder.mockResolvedValue({
          capturedPoysha: 500000n,
          refundedPoysha: 0n,
        });
        repository.sumPendingRefundClaims.mockResolvedValue(250000n);
        repository.findForOrder.mockResolvedValue([
          paymentRow({
            method: PaymentMethod.BKASH,
            gatewayReference: 'PAYID-A',
            gatewayTransactionId: 'TRX-A',
          }),
        ]);
        gateway.refund.mockResolvedValue({
          ok: true,
          reference: 'RFD-A',
          pending: false,
          failureReason: null,
          ambiguous: false,
        });
      });

      it('refuses more than what is left once the claim is netted, without calling bKash', async () => {
        const result = await service.refund(staff, 'ord-1', { amountPoysha: 250001 });

        expect(result).toEqual({
          ok: false,
          status: HttpStatus.BAD_REQUEST,
          message: 'A refund cannot exceed the amount captured.',
        });
        expect(repository.sumPendingRefundClaims).toHaveBeenCalledWith('ord-1');
        expect(gateway.refund).not.toHaveBeenCalled();
      });

      it('refunds by default only what the claim leaves, and marks the order REFUNDED', async () => {
        await service.refund(staff, 'ord-1', {});

        expect(gateway.refund.mock.calls[0][0].amountPoysha).toBe(250000n);
        expect(repository.settle).toHaveBeenCalledWith(
          expect.objectContaining({ amountPoysha: 250000n }),
          PaymentStatus.REFUNDED,
        );
      });

      it('refuses outright when in-flight claims cover everything still captured', async () => {
        repository.totalsForOrder.mockResolvedValue({
          capturedPoysha: 500000n,
          refundedPoysha: 250000n,
        });

        const result = await service.refund(staff, 'ord-1', {});

        expect(result).toEqual({
          ok: false,
          status: HttpStatus.CONFLICT,
          message: 'This order has no captured payment to refund.',
        });
        expect(gateway.refund).not.toHaveBeenCalled();
      });

      it('answers 503 when the in-flight claims cannot be read', async () => {
        repository.sumPendingRefundClaims.mockResolvedValue(null);

        const result = await service.refund(staff, 'ord-1', {});

        expect(result).toEqual({
          ok: false,
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Could not process the payment. Please try again.',
        });
        expect(gateway.refund).not.toHaveBeenCalled();
      });
    });

    it('never calls the gateway for a cash order', async () => {
      await service.refund(staff, 'ord-1', {});

      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('reverses a gateway order through the gateway that took the money, naming its trxID', async () => {
      orders.findById.mockResolvedValue(order({ paymentMethod: PaymentMethod.BKASH }));
      repository.findForOrder.mockResolvedValue([
        paymentRow({
          method: PaymentMethod.BKASH,
          gatewayReference: 'TRX123',
          gatewayTransactionId: 'BKTRX9',
        }),
      ]);
      gateway.refund.mockResolvedValue({
        ok: true,
        reference: 'REF456',
        pending: false,
        failureReason: null,
        ambiguous: false,
      });

      await service.refund(staff, 'ord-1', {});

      expect(gateway.refund).toHaveBeenCalledWith({
        amountPoysha: 250000n,
        originalReference: 'TRX123',
        transactionId: 'BKTRX9',
      });
      expect(repository.settle.mock.calls[0][0].gatewayReference).toBe('REF456');
    });

    it('passes a null trxID through when the charge never recorded one', async () => {
      orders.findById.mockResolvedValue(order({ paymentMethod: PaymentMethod.BKASH }));
      repository.findForOrder.mockResolvedValue([
        paymentRow({ method: PaymentMethod.BKASH, gatewayReference: 'TRX123' }),
      ]);
      gateway.refund.mockResolvedValue({
        ok: false,
        reference: null,
        pending: false,
        failureReason: 'refused',
        ambiguous: false,
      });

      await service.refund(staff, 'ord-1', {});

      expect(gateway.refund.mock.calls[0][0].transactionId).toBeNull();
    });

    it('does not record a refund the gateway refused', async () => {
      orders.findById.mockResolvedValue(order({ paymentMethod: PaymentMethod.BKASH }));
      repository.findForOrder.mockResolvedValue([
        paymentRow({ method: PaymentMethod.BKASH, gatewayReference: 'TRX123' }),
      ]);
      gateway.refund.mockResolvedValue({
        ok: false,
        reference: null,
        pending: false,
        failureReason: 'No payment gateway is configured.',
        ambiguous: false,
      });

      const result = await service.refund(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_GATEWAY,
        message: 'No payment gateway is configured.',
      });
      expect(repository.settle).not.toHaveBeenCalled();
    });

    it('refuses a gateway refund with no original reference to reverse', async () => {
      orders.findById.mockResolvedValue(order({ paymentMethod: PaymentMethod.BKASH }));
      repository.findForOrder.mockResolvedValue([]);

      const result = await service.refund(staff, 'ord-1', {});

      expect(result.ok).toBe(false);
      expect(gateway.refund).not.toHaveBeenCalled();
    });
  });

  describe('an order switched to cash on delivery while a bKash charge is captured', () => {
    // Ruling R16: the bKash capture belongs to the automatic refund. Staff totals count only
    // rows of the order's current method, so the charge neither pays for the order nor can be
    // refunded by hand as cash.
    const totalsByMethod = (cash: bigint) => (_orderId: string, method?: PaymentMethod) =>
      Promise.resolve(
        method === PaymentMethod.CASH_ON_DELIVERY
          ? { capturedPoysha: cash, refundedPoysha: 0n }
          : { capturedPoysha: 250000n + cash, refundedPoysha: 0n },
      );

    beforeEach(() => {
      // The inline refund was refused outright, so its claim was released: nothing in flight.
      repository.totalsForOrder.mockImplementation(totalsByMethod(0n));
    });

    it('lets staff collect the full total in cash rather than answering already paid', async () => {
      const result = await service.collectCash(staff, 'ord-1', {});

      expect(result.ok).toBe(true);
      expect(repository.totalsForOrder).toHaveBeenCalledWith(
        'ord-1',
        PaymentMethod.CASH_ON_DELIVERY,
      );
      expect(repository.settle).toHaveBeenCalledWith(
        expect.objectContaining({
          method: PaymentMethod.CASH_ON_DELIVERY,
          amountPoysha: 250000n,
        }),
        PaymentStatus.PAID,
      );
    });

    it('refuses a staff refund that could only net against the bKash capture', async () => {
      const result = await service.refund(staff, 'ord-1', {});

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This order has no captured payment to refund.',
      });
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(repository.settle).not.toHaveBeenCalled();
    });

    it('refunds only the cash once it is collected, never the bKash capture', async () => {
      repository.totalsForOrder.mockImplementation(totalsByMethod(250000n));

      const result = await service.refund(staff, 'ord-1', {});

      expect(result.ok).toBe(true);
      expect(repository.settle).toHaveBeenCalledWith(
        expect.objectContaining({
          method: PaymentMethod.CASH_ON_DELIVERY,
          direction: PaymentDirection.REFUND,
          amountPoysha: 250000n,
        }),
        PaymentStatus.REFUNDED,
      );
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('never nets a bKash refund claim against a cash refund', async () => {
      repository.totalsForOrder.mockImplementation(totalsByMethod(250000n));
      repository.sumPendingRefundClaims.mockResolvedValue(250000n);

      await service.refund(staff, 'ord-1', {});

      expect(repository.settle).toHaveBeenCalledWith(
        expect.objectContaining({ amountPoysha: 250000n }),
        PaymentStatus.REFUNDED,
      );
    });

    it("scopes a bKash order's refundable to its bKash rows", async () => {
      orders.findById.mockResolvedValue(order({ paymentMethod: PaymentMethod.BKASH }));

      await service.refund(staff, 'ord-1', {});

      expect(repository.totalsForOrder).toHaveBeenCalledWith('ord-1', PaymentMethod.BKASH);
    });
  });

  describe('summaryForOrder', () => {
    it('reports what is still outstanding from the ledger', async () => {
      repository.totalsForOrder.mockResolvedValue({
        capturedPoysha: 200000n,
        refundedPoysha: 50000n,
      });
      repository.findForOrder.mockResolvedValue([paymentRow()]);

      const result = await service.summaryForOrder('ord-1');

      expect(result.ok && result.data).toMatchObject({
        orderId: 'ord-1',
        totalPoysha: 250000,
        capturedPoysha: 200000,
        refundedPoysha: 50000,
        outstandingPoysha: 100000,
      });
    });

    it('never exposes which staff member took the cash', async () => {
      repository.findForOrder.mockResolvedValue([paymentRow({ collectedBy: 'rider-9' })]);

      const result = await service.summaryForOrder('ord-1');

      expect(result.ok && JSON.stringify(result.data)).not.toContain('rider-9');
    });

    it('reports 503 when the ledger cannot be read', async () => {
      repository.findForOrder.mockResolvedValue(null);

      const result = await service.summaryForOrder('ord-1');

      expect(result.ok).toBe(false);
    });
  });

  describe('resolveRefundClaim', () => {
    const admin: AuthenticatedUser = {
      userId: 'sub-9',
      sessionId: 'session-9',
      email: 'admin@barakahbazaar.com.bd',
      role: UserRole.SUPER_ADMIN,
    };

    const claim = (overrides = {}) =>
      paymentRow({
        id: 'claim-1',
        method: PaymentMethod.BKASH,
        direction: PaymentDirection.REFUND,
        status: PaymentTransactionStatus.PENDING,
        gatewayReference: 'refund:TRX-1',
        collectedBy: null,
        capturedAt: null,
        ...overrides,
      });

    const auditFor = (after: object) => ({
      actorId: 'user-1',
      actorEmail: 'admin@barakahbazaar.com.bd',
      actorRole: UserRole.SUPER_ADMIN,
      action: 'payment.refund_claim_resolved',
      entityType: 'PaymentTransaction',
      entityId: 'claim-1',
      before: {
        status: 'PENDING',
        orderId: 'ord-1',
        amountPoysha: 250000,
        gatewayReference: 'refund:TRX-1',
      },
      after,
      requestId: null,
    });

    beforeEach(() => {
      repository.findById.mockResolvedValue(claim());
      // The claim is netted as in flight, so a cancelled order it clears is owed nothing now.
      repository.findOwedForOrder.mockResolvedValue({ cancelled: true, owedPoysha: 0n });
    });

    it('completes the claim with the trxID staff found, marks a cleared cancelled order REFUNDED, and audits it', async () => {
      const result = await service.resolveRefundClaim(admin, 'claim-1', {
        outcome: 'refunded',
        refundTransactionId: 'RFD-PORTAL-1',
      });

      expect(result).toEqual({
        ok: true,
        data: { claimId: 'claim-1', orderId: 'ord-1', outcome: 'refunded', orderRefunded: true },
      });
      expect(repository.findOwedForOrder).toHaveBeenCalledWith('ord-1');
      expect(repository.completeRefund).toHaveBeenCalledWith(
        'claim-1',
        'RFD-PORTAL-1',
        true,
        auditFor({ outcome: 'refunded', refundTransactionId: 'RFD-PORTAL-1', orderRefunded: true }),
      );
      expect(repository.releaseRefundClaim).not.toHaveBeenCalled();
    });

    it('leaves the order alone when money is still owed after this claim, as the sweep would', async () => {
      repository.findOwedForOrder.mockResolvedValue({ cancelled: true, owedPoysha: 1n });

      await service.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' });

      expect(repository.completeRefund.mock.calls[0][2]).toBe(false);
    });

    it('never marks an order that is not cancelled REFUNDED', async () => {
      repository.findOwedForOrder.mockResolvedValue({ cancelled: false, owedPoysha: 0n });

      await service.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' });

      expect(repository.completeRefund.mock.calls[0][2]).toBe(false);
    });

    it('records a null refund trxID when staff have none', async () => {
      await service.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' });

      expect(repository.completeRefund.mock.calls[0][1]).toBeNull();
    });

    it('releases the claim when bKash never refunded it, so the sweep may try again, and audits it', async () => {
      const result = await service.resolveRefundClaim(admin, 'claim-1', {
        outcome: 'not-refunded',
      });

      expect(result).toEqual({
        ok: true,
        data: {
          claimId: 'claim-1',
          orderId: 'ord-1',
          outcome: 'not-refunded',
          orderRefunded: false,
        },
      });
      expect(repository.releaseRefundClaim).toHaveBeenCalledWith(
        'claim-1',
        auditFor({ outcome: 'not-refunded', refundTransactionId: null, orderRefunded: false }),
      );
      expect(repository.completeRefund).not.toHaveBeenCalled();
      expect(repository.findOwedForOrder).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown id', () => repository.findById.mockResolvedValue(undefined)],
      [
        'a charge rather than a refund',
        () => repository.findById.mockResolvedValue(claim({ direction: PaymentDirection.CHARGE })),
      ],
      [
        'a cash refund',
        () =>
          repository.findById.mockResolvedValue(claim({ method: PaymentMethod.CASH_ON_DELIVERY })),
      ],
    ])('answers 404 for %s and changes nothing', async (_case, arrange) => {
      arrange();

      const result = await service.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Refund claim not found.',
      });
      expect(repository.completeRefund).not.toHaveBeenCalled();
      expect(repository.releaseRefundClaim).not.toHaveBeenCalled();
    });

    it('answers 409 for a claim that is no longer PENDING and changes nothing', async () => {
      repository.findById.mockResolvedValue(claim({ status: PaymentTransactionStatus.CAPTURED }));

      const result = await service.resolveRefundClaim(admin, 'claim-1', {
        outcome: 'not-refunded',
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This refund claim has already been resolved.',
      });
      expect(repository.releaseRefundClaim).not.toHaveBeenCalled();
    });

    it('answers 400 for a refund trxID on a claim that was never refunded', async () => {
      const result = await service.resolveRefundClaim(admin, 'claim-1', {
        outcome: 'not-refunded',
        refundTransactionId: 'RFD-PORTAL-1',
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'A refund transaction ID can only be given when the refund was made.',
      });
      expect(repository.releaseRefundClaim).not.toHaveBeenCalled();
    });

    it.each([
      ['the claim was resolved by someone else first', 'refunded', false],
      ['the claim was released by someone else first', 'not-refunded', false],
    ] as const)('answers 409 when %s', async (_case, outcome, written) => {
      repository.completeRefund.mockResolvedValue(written);
      repository.releaseRefundClaim.mockResolvedValue(written);

      const result = await service.resolveRefundClaim(admin, 'claim-1', { outcome });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This refund claim has already been resolved.',
      });
    });

    it('answers 409 when the refund trxID is already recorded on another row', async () => {
      repository.completeRefund.mockResolvedValue('duplicate');

      const result = await service.resolveRefundClaim(admin, 'claim-1', {
        outcome: 'refunded',
        refundTransactionId: 'RFD-PORTAL-1',
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That bKash refund transaction ID is already recorded.',
      });
    });

    it.each([
      ['the claim cannot be read', () => repository.findById.mockResolvedValue(null), 'refunded'],
      [
        'what the order is owed cannot be read',
        () => repository.findOwedForOrder.mockResolvedValue(null),
        'refunded',
      ],
      [
        'the completion cannot be written',
        () => repository.completeRefund.mockResolvedValue(null),
        'refunded',
      ],
      [
        'the release cannot be written',
        () => repository.releaseRefundClaim.mockResolvedValue(null),
        'not-refunded',
      ],
    ] as const)('answers 503 when %s', async (_case, arrange, outcome) => {
      arrange();

      const result = await service.resolveRefundClaim(admin, 'claim-1', { outcome });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not process the payment. Please try again.',
      });
    });

    it('treats an order with no bKash money left to net as not cleared', async () => {
      repository.findOwedForOrder.mockResolvedValue(undefined);

      await service.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' });

      expect(repository.completeRefund.mock.calls[0][2]).toBe(false);
    });

    it('passes a refused staff account straight through', async () => {
      const refused = { ok: false, status: HttpStatus.FORBIDDEN, message: 'Account disabled.' };
      authService.resolveActiveUserId.mockResolvedValue(refused);

      await expect(
        service.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' }),
      ).resolves.toEqual(refused);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('answers 500 and logs when something throws', async () => {
      repository.findById.mockRejectedValue(new Error('boom'));

      const result = await service.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ claimId: 'claim-1' }),
        'Exception occurred in PaymentService.resolveRefundClaim',
      );
    });
  });

  describe('list', () => {
    it('filters by status and direction, so stale refund claims can be listed', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 0 });

      await service.list({
        status: PaymentTransactionStatus.PENDING,
        direction: PaymentDirection.REFUND,
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        { status: PaymentTransactionStatus.PENDING, direction: PaymentDirection.REFUND },
        0,
        20,
      );
    });

    it('exposes the bKash trxID on each ledger row', async () => {
      repository.findPage.mockResolvedValue({
        items: [paymentRow({ method: PaymentMethod.BKASH, gatewayTransactionId: 'TRX-9' })],
        total: 1,
      });

      const result = await service.list({});

      expect(result.ok && result.data.items[0].gatewayTransactionId).toBe('TRX-9');
    });

    it('defaults to the first page of twenty', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 0 });

      await service.list({});

      expect(repository.findPage).toHaveBeenCalledWith({}, 0, 20);
    });

    it('pages from one rather than zero', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 0 });

      await service.list({ page: 3, pageSize: 10 });

      expect(repository.findPage).toHaveBeenCalledWith({}, 20, 10);
    });

    it('reports 503 when the ledger cannot be read', async () => {
      repository.findPage.mockResolvedValue(null);

      const result = await service.list({});

      expect(result.ok).toBe(false);
    });
  });
});

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

const staff: AuthenticatedUser = { supabaseUserId: 'sub-1', role: UserRole.OPS };

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
    };
    orders = { findById: jest.fn().mockResolvedValue(order()) };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    gateway = { charge: jest.fn(), refund: jest.fn() };
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

    it('never calls the gateway for a cash order', async () => {
      await service.refund(staff, 'ord-1', {});

      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('reverses a gateway order through the gateway that took the money', async () => {
      orders.findById.mockResolvedValue(order({ paymentMethod: PaymentMethod.BKASH }));
      repository.findForOrder.mockResolvedValue([
        paymentRow({ method: PaymentMethod.BKASH, gatewayReference: 'TRX123' }),
      ]);
      gateway.refund.mockResolvedValue({
        ok: true,
        reference: 'REF456',
        pending: false,
        failureReason: null,
      });

      await service.refund(staff, 'ord-1', {});

      expect(gateway.refund).toHaveBeenCalledWith({
        amountPoysha: 250000n,
        originalReference: 'TRX123',
      });
      expect(repository.settle.mock.calls[0][0].gatewayReference).toBe('REF456');
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

  describe('list', () => {
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

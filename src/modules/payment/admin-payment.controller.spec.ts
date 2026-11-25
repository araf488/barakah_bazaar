import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { MetadataKeys } from '../../common/constants/app.constants';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminPaymentController } from './admin-payment.controller';
import { PaymentService } from './payment.service';

const staff: AuthenticatedUser = {
  userId: 'sub-1',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.OPS,
};

describe('AdminPaymentController', () => {
  let service: {
    list: jest.Mock;
    summaryForOrder: jest.Mock;
    collectCash: jest.Mock;
    refund: jest.Mock;
    resolveRefundClaim: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let controller: AdminPaymentController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      summaryForOrder: jest.fn(),
      collectCash: jest.fn(),
      refund: jest.fn(),
      resolveRefundClaim: jest.fn(),
    };
    logger = createMockLogger();
    controller = new AdminPaymentController(service as unknown as PaymentService, logger);
  });

  it('returns the ledger page', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 20 };
    service.list.mockResolvedValue({ ok: true, data: page });

    await expect(controller.list({})).resolves.toEqual(page);
  });

  it('passes the caller and the body through when recording cash', async () => {
    service.collectCash.mockResolvedValue({ ok: true, data: { id: 'pay-1' } });

    await controller.collectCash(staff, 'ord-1', { amountPoysha: 100000 });

    expect(service.collectCash).toHaveBeenCalledWith(staff, 'ord-1', { amountPoysha: 100000 });
  });

  it('passes the caller and the body through when refunding', async () => {
    service.refund.mockResolvedValue({ ok: true, data: { id: 'pay-2' } });

    await controller.refund(staff, 'ord-1', { amountPoysha: 50000, reason: 'damaged' });

    expect(service.refund).toHaveBeenCalledWith(staff, 'ord-1', {
      amountPoysha: 50000,
      reason: 'damaged',
    });
  });

  it('turns a refused collection into the matching HTTP status', async () => {
    service.collectCash.mockResolvedValue({
      ok: false,
      status: HttpStatus.CONFLICT,
      message: 'This order has already been paid.',
    });

    await expect(controller.collectCash(staff, 'ord-1', {})).rejects.toThrow(HttpException);
    await expect(controller.collectCash(staff, 'ord-1', {})).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('turns a missing order into a 404', async () => {
    service.summaryForOrder.mockResolvedValue({
      ok: false,
      status: HttpStatus.NOT_FOUND,
      message: 'Order not found.',
    });

    await expect(controller.summary('ord-1')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  describe('resolveRefundClaim', () => {
    const admin: AuthenticatedUser = { ...staff, role: UserRole.SUPER_ADMIN };
    const handler = AdminPaymentController.prototype.resolveRefundClaim;

    it('is SUPER_ADMIN only, though the rest of the ledger is open to OPS', () => {
      const reflector = new Reflector();

      expect(reflector.get(MetadataKeys.Roles, handler)).toEqual(['SUPER_ADMIN']);
      expect(reflector.get(MetadataKeys.Roles, AdminPaymentController)).toEqual([
        'SUPER_ADMIN',
        'OPS',
      ]);
    });

    it('is POST refund-claims/:id/resolve, answering 200', () => {
      expect(Reflect.getMetadata('path', handler)).toBe('refund-claims/:id/resolve');
      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
    });

    it('passes the caller, the claim and the body through and answers the resolution', async () => {
      const resolution = {
        claimId: 'claim-1',
        orderId: 'ord-1',
        outcome: 'refunded',
        orderRefunded: true,
      };
      service.resolveRefundClaim.mockResolvedValue({ ok: true, data: resolution });

      await expect(
        controller.resolveRefundClaim(admin, 'claim-1', {
          outcome: 'refunded',
          refundTransactionId: 'RFD-PORTAL-1',
        }),
      ).resolves.toEqual(resolution);
      expect(service.resolveRefundClaim).toHaveBeenCalledWith(admin, 'claim-1', {
        outcome: 'refunded',
        refundTransactionId: 'RFD-PORTAL-1',
      });
    });

    it.each([
      [HttpStatus.NOT_FOUND, 'Refund claim not found.'],
      [HttpStatus.CONFLICT, 'This refund claim has already been resolved.'],
    ])('turns a refusal into %s', async (status, message) => {
      service.resolveRefundClaim.mockResolvedValue({ ok: false, status, message });

      await expect(
        controller.resolveRefundClaim(admin, 'claim-1', { outcome: 'not-refunded' }),
      ).rejects.toMatchObject({ status, message });
    });

    it('logs the failure with the claim id before rethrowing', async () => {
      service.resolveRefundClaim.mockRejectedValue(new Error('boom'));

      await expect(
        controller.resolveRefundClaim(admin, 'claim-1', { outcome: 'refunded' }),
      ).rejects.toThrow('boom');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ claimId: 'claim-1' }),
        'Exception occurred in AdminPaymentController.resolveRefundClaim',
      );
    });
  });

  it('logs the failure with the exception object before rethrowing', async () => {
    service.list.mockRejectedValue(new Error('boom'));

    await expect(controller.list({})).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalled();
  });
});

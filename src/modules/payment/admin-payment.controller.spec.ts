import { HttpException, HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminPaymentController } from './admin-payment.controller';
import { PaymentService } from './payment.service';

const staff: AuthenticatedUser = { supabaseUserId: 'sub-1', role: UserRole.OPS };

describe('AdminPaymentController', () => {
  let service: {
    list: jest.Mock;
    summaryForOrder: jest.Mock;
    collectCash: jest.Mock;
    refund: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let controller: AdminPaymentController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      summaryForOrder: jest.fn(),
      collectCash: jest.fn(),
      refund: jest.fn(),
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

  it('logs the failure with the exception object before rethrowing', async () => {
    service.list.mockRejectedValue(new Error('boom'));

    await expect(controller.list({})).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalled();
  });
});

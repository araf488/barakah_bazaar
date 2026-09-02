import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { SlotQueryDto } from '../delivery/dto/slot.dto';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

const customer: AuthenticatedUser = { supabaseUserId: 'sub-1', role: UserRole.CUSTOMER };

const query = (overrides: Partial<SlotQueryDto> = {}): SlotQueryDto =>
  Object.assign(new SlotQueryDto(), { addressId: 'address-1' }, overrides);

const occurrence = (overrides = {}) => ({
  slotId: 'slot-1',
  date: new Date(2026, 0, 5),
  startMinute: 540,
  endMinute: 660,
  remaining: 4,
  supportsPerishable: true,
  ...overrides,
});

describe('OrderController', () => {
  let orderService: Record<string, jest.Mock>;
  let logger: jest.Mocked<PinoLogger>;
  let controller: OrderController;

  beforeEach(() => {
    orderService = {
      placeOrder: jest.fn(),
      listMyOrders: jest.fn(),
      getMyOrder: jest.fn(),
      cancelMyOrder: jest.fn(),
      listDeliverySlots: jest.fn().mockResolvedValue({ ok: true, data: [] }),
    };
    logger = createMockLogger();
    controller = new OrderController(orderService as unknown as OrderService, logger);
  });

  describe('delivery windows', () => {
    it('asks for windows for the caller and the address they chose', async () => {
      await controller.deliverySlots(customer, query());

      expect(orderService.listDeliverySlots).toHaveBeenCalledWith(customer, 'address-1', 7);
    });

    it('falls back to the seven-day horizon when none was asked for', async () => {
      await controller.deliverySlots(customer, query({ days: undefined }));

      expect(orderService.listDeliverySlots.mock.calls[0][2]).toBe(7);
    });

    it('honours the horizon the customer asked for', async () => {
      await controller.deliverySlots(customer, query({ days: 3 }));

      expect(orderService.listDeliverySlots.mock.calls[0][2]).toBe(3);
    });

    it('renders the date as a local calendar day', async () => {
      // toISOString would render 2026-01-04 anywhere east of Greenwich — the day before the
      // van actually arrives.
      orderService.listDeliverySlots.mockResolvedValue({ ok: true, data: [occurrence()] });

      const result = await controller.deliverySlots(customer, query());

      expect(result).toEqual([
        {
          slotId: 'slot-1',
          date: '2026-01-05',
          startMinute: 540,
          endMinute: 660,
          remaining: 4,
          supportsPerishable: true,
        },
      ]);
    });

    it('keeps every window the service offered', async () => {
      orderService.listDeliverySlots.mockResolvedValue({
        ok: true,
        data: [occurrence(), occurrence({ slotId: 'slot-2', startMinute: 900, endMinute: 1020 })],
      });

      const result = await controller.deliverySlots(customer, query());

      expect(result).toHaveLength(2);
    });

    it('turns an unreachable address into the status the service chose', async () => {
      orderService.listDeliverySlots.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Delivery is not available to that address yet. Please contact support.',
      });

      await expect(controller.deliverySlots(customer, query())).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    });

    it('turns an address that is not the caller own into a 404', async () => {
      orderService.listDeliverySlots.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'That delivery address is no longer available.',
      });

      await expect(controller.deliverySlots(customer, query())).rejects.toThrow(HttpException);
    });

    it('logs and rethrows when the service throws', async () => {
      orderService.listDeliverySlots.mockRejectedValue(new Error('boom'));

      await expect(controller.deliverySlots(customer, query())).rejects.toThrow('boom');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('the caller must be signed in', () => {
    // The global auth guard normally guarantees this, but the guard is opt-out: a route
    // marked @Public() would hand the handler no user at all.
    it('refuses to place an order for nobody', async () => {
      await expect(controller.place(undefined, { addressId: 'address-1' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(orderService.placeOrder).not.toHaveBeenCalled();
    });

    it('refuses to list orders for nobody', async () => {
      await expect(controller.list(undefined, {} as never)).rejects.toThrow(UnauthorizedException);
    });

    it('refuses to read one order for nobody', async () => {
      await expect(controller.get(undefined, 'order-1')).rejects.toThrow(UnauthorizedException);
    });

    it('refuses to cancel an order for nobody', async () => {
      await expect(controller.cancel(undefined, 'order-1', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('the customer own orders', () => {
    it('reads one order through the caller identity', async () => {
      orderService.getMyOrder.mockResolvedValue({ ok: true, data: { id: 'order-1' } });

      await controller.get(customer, 'order-1');

      expect(orderService.getMyOrder).toHaveBeenCalledWith(customer, 'order-1');
    });

    it('logs with the order id when reading throws', async () => {
      orderService.getMyOrder.mockRejectedValue(new Error('boom'));

      await expect(controller.get(customer, 'order-1')).rejects.toThrow('boom');
      expect(logger.error.mock.calls[0][0]).toMatchObject({ orderId: 'order-1' });
    });

    it('logs with the order id when cancelling throws', async () => {
      orderService.cancelMyOrder.mockRejectedValue(new Error('boom'));

      await expect(controller.cancel(customer, 'order-1', {})).rejects.toThrow('boom');
      expect(logger.error.mock.calls[0][0]).toMatchObject({ orderId: 'order-1' });
    });
  });
});

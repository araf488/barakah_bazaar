import { HttpException, HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MetadataKeys } from '../../common/constants/app.constants';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminDeliveryService } from './admin-delivery.service';
import { AdminDeliveryController, DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

const staff: AuthenticatedUser = { supabaseUserId: 'sub-1', role: UserRole.OPS };

describe('DeliveryController', () => {
  let delivery: { quote: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let controller: DeliveryController;

  beforeEach(() => {
    delivery = { quote: jest.fn() };
    logger = createMockLogger();
    controller = new DeliveryController(delivery as unknown as DeliveryService, logger);
  });

  it('quotes for the destination and basket value given', async () => {
    delivery.quote.mockResolvedValue({ ok: true, data: { feePoysha: 6000 } });

    await controller.quote({
      division: 'Dhaka',
      district: 'Dhaka',
      unit: 'Gulshan',
      subtotalPoysha: 150000,
    });

    expect(delivery.quote).toHaveBeenCalledWith(
      { division: 'Dhaka', district: 'Dhaka', unit: 'Gulshan' },
      150000n,
    );
  });

  it('passes an unpriced destination through as 422', async () => {
    delivery.quote.mockResolvedValue({
      ok: false,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Delivery is not available to that address yet. Please contact support.',
    });

    await expect(
      controller.quote({ division: 'X', district: 'Y', unit: 'Z', subtotalPoysha: 0 }),
    ).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
  });
});

describe('AdminDeliveryController', () => {
  let zones: Record<string, jest.Mock>;
  let logger: jest.Mocked<PinoLogger>;
  let controller: AdminDeliveryController;

  beforeEach(() => {
    zones = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      listSlots: jest.fn(),
      createSlot: jest.fn(),
      updateSlot: jest.fn(),
    };
    logger = createMockLogger();
    controller = new AdminDeliveryController(zones as unknown as AdminDeliveryService, logger);
  });

  it('restricts pricing management to super admins and ops', () => {
    expect(new Reflector().get(MetadataKeys.Roles, AdminDeliveryController)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.OPS,
    ]);
  });

  it('leaves the customer quote endpoint open to any signed-in caller', () => {
    expect(new Reflector().get(MetadataKeys.Roles, DeliveryController)).toBeUndefined();
  });

  it('treats a missing activeOnly flag as "show everything"', async () => {
    zones.list.mockResolvedValue({ ok: true, data: [] });

    await controller.list();

    expect(zones.list).toHaveBeenCalledWith(false);
  });

  it('filters to active zones when asked', async () => {
    zones.list.mockResolvedValue({ ok: true, data: [] });

    await controller.list('true');

    expect(zones.list).toHaveBeenCalledWith(true);
  });

  it('passes the actor through when creating', async () => {
    zones.create.mockResolvedValue({ ok: true, data: { id: 'zone-1' } });

    await controller.create(staff, { nameEn: 'Inside Dhaka', feePoysha: 6000 });

    expect(zones.create).toHaveBeenCalledWith(staff, { nameEn: 'Inside Dhaka', feePoysha: 6000 });
  });

  it('turns an overlapping zone into a 409', async () => {
    zones.create.mockResolvedValue({
      ok: false,
      status: HttpStatus.CONFLICT,
      message: 'That place already belongs to another delivery zone.',
    });

    await expect(controller.create(staff, { nameEn: 'X', feePoysha: 0 })).rejects.toThrow(
      HttpException,
    );
  });

  it('logs with the zone id when an update throws', async () => {
    zones.update.mockRejectedValue(new Error('boom'));

    await expect(controller.update(staff, 'zone-1', { nameEn: 'X', feePoysha: 0 })).rejects.toThrow(
      'boom',
    );

    expect(logger.error.mock.calls[0][0]).toMatchObject({ zoneId: 'zone-1' });
  });

  describe('delivery windows', () => {
    const slot = {
      id: 'slot-1',
      warehouseId: 'wh-1',
      labelEn: 'Morning 9-11',
      startMinute: 540,
      endMinute: 660,
      capacity: 20,
    };

    const upsert = (overrides = {}) => ({
      warehouseId: 'wh-1',
      labelEn: 'Morning 9-11',
      startMinute: 540,
      endMinute: 660,
      daysOfWeek: [0, 1, 2],
      capacity: 20,
      ...overrides,
    });

    it('lists every window across all hubs', async () => {
      zones.listSlots.mockResolvedValue({ ok: true, data: [slot] });

      expect(await controller.listSlots()).toEqual([slot]);
    });

    it('turns unreadable windows into a 503', async () => {
      zones.listSlots.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not load delivery pricing. Please try again.',
      });

      await expect(controller.listSlots()).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });

    it('passes the actor through when creating, so the audit row names them', async () => {
      zones.createSlot.mockResolvedValue({ ok: true, data: slot });

      await controller.createSlot(staff, upsert());

      expect(zones.createSlot).toHaveBeenCalledWith(staff, upsert());
    });

    it('turns an inverted window into a 400', async () => {
      zones.createSlot.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'A delivery window must end after it starts.',
      });

      await expect(
        controller.createSlot(staff, upsert({ startMinute: 660, endMinute: 540 }) as never),
      ).rejects.toThrow(HttpException);
    });

    it('passes the actor and the id through when updating', async () => {
      zones.updateSlot.mockResolvedValue({ ok: true, data: slot });

      await controller.updateSlot(staff, 'slot-1', upsert());

      expect(zones.updateSlot).toHaveBeenCalledWith(staff, 'slot-1', upsert());
    });

    it('logs with the slot id when an update throws', async () => {
      zones.updateSlot.mockRejectedValue(new Error('boom'));

      await expect(controller.updateSlot(staff, 'slot-1', upsert() as never)).rejects.toThrow(
        'boom',
      );

      expect(logger.error.mock.calls[0][0]).toMatchObject({ slotId: 'slot-1' });
    });

    it('logs when a create throws', async () => {
      zones.createSlot.mockRejectedValue(new Error('boom'));

      await expect(controller.createSlot(staff, upsert() as never)).rejects.toThrow('boom');
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

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
  let zones: { list: jest.Mock; create: jest.Mock; update: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let controller: AdminDeliveryController;

  beforeEach(() => {
    zones = { list: jest.fn(), create: jest.fn(), update: jest.fn() };
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
});

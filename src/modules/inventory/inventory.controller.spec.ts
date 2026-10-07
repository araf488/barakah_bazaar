import { HttpException, HttpStatus, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StockMovementReason, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdjustStockDto, ReceiveStockDto, StockQueryDto } from './dto/inventory.dto';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { WarehouseService } from './warehouse.service';

const staff: AuthenticatedUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.WAREHOUSE,
};

const validReceipt = { warehouseId: 'wh-1', variantId: 'var-1', quantity: 100 };
const validAdjust = {
  warehouseId: 'wh-1',
  variantId: 'var-1',
  delta: -3,
  reason: StockMovementReason.DAMAGE,
  note: 'Crushed in transit',
};

describe('InventoryController', () => {
  let inventoryService: Record<string, jest.Mock>;
  let warehouseService: Record<string, jest.Mock>;
  let controller: InventoryController;

  beforeEach(() => {
    inventoryService = {
      listStock: jest.fn().mockResolvedValue({ ok: true, data: { items: [], meta: {} } }),
      receiveStock: jest.fn().mockResolvedValue({ ok: true, data: { id: 'mv-1' } }),
      adjustStock: jest.fn().mockResolvedValue({ ok: true, data: { variantId: 'var-1' } }),
      listMovements: jest.fn().mockResolvedValue({ ok: true, data: [] }),
    };
    warehouseService = {
      listWarehouses: jest.fn().mockResolvedValue({ ok: true, data: [] }),
      createWarehouse: jest.fn().mockResolvedValue({ ok: true, data: { id: 'wh-1' } }),
      updateWarehouse: jest.fn().mockResolvedValue({ ok: true, data: { id: 'wh-1' } }),
      deactivateWarehouse: jest.fn().mockResolvedValue({ ok: true, data: { id: 'wh-1' } }),
      reactivateWarehouse: jest.fn().mockResolvedValue({ ok: true, data: { id: 'wh-1' } }),
    };
    controller = new InventoryController(
      inventoryService as unknown as InventoryService,
      warehouseService as unknown as WarehouseService,
      createMockLogger(),
    );
  });

  describe('warehouse lifecycle roles', () => {
    const reflector = new Reflector();
    const methodRoles = (method: keyof InventoryController) =>
      reflector.get<string[] | undefined>(
        MetadataKeys.Roles,
        InventoryController.prototype[method],
      );

    it.each([
      'createWarehouse',
      'updateWarehouse',
      'deactivateWarehouse',
      'reactivateWarehouse',
    ] as const)('%s carries no method-level Roles metadata', (method) => {
      expect(methodRoles(method)).toBeUndefined();
    });

    it('keeps the class-level roles at SUPER_ADMIN and WAREHOUSE', () => {
      expect(reflector.get(MetadataKeys.Roles, InventoryController)).toEqual([
        'SUPER_ADMIN',
        'WAREHOUSE',
      ]);
    });

    it('passes the remaining active hub count through on deactivation', async () => {
      warehouseService.deactivateWarehouse.mockResolvedValue({
        ok: true,
        data: { id: 'wh-1', activeWarehousesRemaining: 2 },
      });

      const result = await controller.deactivateWarehouse(
        staff,
        '11111111-1111-1111-1111-111111111111',
      );

      expect(result).toEqual({ id: 'wh-1', activeWarehousesRemaining: 2 });
    });

    it('routes PATCH warehouses/:id/reactivate with 200', () => {
      const handler = InventoryController.prototype.reactivateWarehouse;

      expect(Reflect.getMetadata('path', handler)).toBe('warehouses/:id/reactivate');
      expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.PATCH);
      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
    });

    it('reactivates for the verified caller and passes the active count through', async () => {
      warehouseService.reactivateWarehouse.mockResolvedValue({
        ok: true,
        data: { id: 'wh-1', isActive: true, activeWarehousesRemaining: 3 },
      });

      const result = await controller.reactivateWarehouse(staff, 'wh-1');

      expect(result).toEqual({ id: 'wh-1', isActive: true, activeWarehousesRemaining: 3 });
      expect(warehouseService.reactivateWarehouse).toHaveBeenCalledWith(staff, 'wh-1');
    });

    it('surfaces a missing hub on reactivation as 404', async () => {
      warehouseService.reactivateWarehouse.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Warehouse was not found.',
      });

      await expect(controller.reactivateWarehouse(staff, 'wh-9')).rejects.toMatchObject({
        status: 404,
        message: 'Warehouse was not found.',
      });
    });

    it('refuses a reactivation with no verified caller', async () => {
      await expect(controller.reactivateWarehouse(undefined, 'wh-1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(warehouseService.reactivateWarehouse).not.toHaveBeenCalled();
    });

    it('surfaces the last cold-capable hub conflict on deactivation', async () => {
      warehouseService.deactivateWarehouse.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          'This is the only active hub that can store CHILLED items. Open or reactivate another CHILLED-capable hub first.',
      });

      await expect(controller.deactivateWarehouse(staff, 'wh-1')).rejects.toMatchObject({
        status: 409,
        message:
          'This is the only active hub that can store CHILLED items. Open or reactivate another CHILLED-capable hub first.',
      });
    });
  });

  describe('routing', () => {
    it('passes the query through to the service', async () => {
      const query = Object.assign(new StockQueryDto(), { lowStockOnly: true });

      await controller.list(query);

      expect(inventoryService.listStock).toHaveBeenCalledWith(query);
    });

    it('books a receipt for the verified caller', async () => {
      const dto = Object.assign(new ReceiveStockDto(), validReceipt);

      await controller.receive(staff, dto);

      expect(inventoryService.receiveStock).toHaveBeenCalledWith(staff, dto);
    });

    it('refuses a receipt with no verified caller', async () => {
      const dto = Object.assign(new ReceiveStockDto(), validReceipt);

      await expect(controller.receive(undefined, dto)).rejects.toThrow(UnauthorizedException);
      expect(inventoryService.receiveStock).not.toHaveBeenCalled();
    });

    it('surfaces the reserved-stock conflict', async () => {
      inventoryService.adjustStock.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          '5 of the 20 units on hand are reserved for checkouts in progress and cannot be removed.',
      });

      await expect(
        controller.adjust(staff, Object.assign(new AdjustStockDto(), validAdjust)),
      ).rejects.toThrow(
        '5 of the 20 units on hand are reserved for checkouts in progress and cannot be removed.',
      );
    });

    it('translates a read failure into an HTTP error', async () => {
      inventoryService.listMovements.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.movements('wh-1', 'var-1')).rejects.toThrow(HttpException);
    });
  });

  describe('ReceiveStockDto validation', () => {
    it('accepts a valid receipt', async () => {
      await expect(validate(plainToInstance(ReceiveStockDto, validReceipt))).resolves.toEqual([]);
    });

    it.each([
      ['zero', 0],
      ['negative', -5],
    ])('rejects a %s quantity — a receipt adds stock', async (_label, quantity) => {
      const errors = await validate(
        plainToInstance(ReceiveStockDto, { ...validReceipt, quantity }),
      );

      expect(errors).not.toEqual([]);
    });

    it('rejects a fractional quantity', async () => {
      const errors = await validate(
        plainToInstance(ReceiveStockDto, { ...validReceipt, quantity: 2.5 }),
      );

      expect(errors).not.toEqual([]);
    });

    it('rejects an implausibly large quantity, which is usually a typo', async () => {
      const errors = await validate(
        plainToInstance(ReceiveStockDto, { ...validReceipt, quantity: 9_000_000 }),
      );

      expect(errors).not.toEqual([]);
    });

    it('rejects a non-ISO expiry', async () => {
      const errors = await validate(
        plainToInstance(ReceiveStockDto, { ...validReceipt, expiresAt: '31-12-2026' }),
      );

      expect(errors).not.toEqual([]);
    });
  });

  describe('AdjustStockDto validation', () => {
    it('accepts a valid adjustment', async () => {
      await expect(validate(plainToInstance(AdjustStockDto, validAdjust))).resolves.toEqual([]);
    });

    it('requires a note — an unexplained adjustment is indistinguishable from theft', async () => {
      const payload: Record<string, unknown> = { ...validAdjust };
      delete payload.note;

      const errors = await validate(plainToInstance(AdjustStockDto, payload));

      expect(errors.map((error) => error.property)).toContain('note');
    });

    it('rejects a whitespace-only note', async () => {
      const errors = await validate(
        plainToInstance(AdjustStockDto, { ...validAdjust, note: '   ' }),
      );

      expect(errors).not.toEqual([]);
    });

    it('requires a reason from the closed set', async () => {
      const errors = await validate(
        plainToInstance(AdjustStockDto, { ...validAdjust, reason: 'BECAUSE' }),
      );

      expect(errors).not.toEqual([]);
    });

    it('allows a negative delta, which is the common case', async () => {
      await expect(
        validate(plainToInstance(AdjustStockDto, { ...validAdjust, delta: -1 })),
      ).resolves.toEqual([]);
    });
  });
});

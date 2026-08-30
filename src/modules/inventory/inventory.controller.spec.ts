import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StockMovementReason, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdjustStockDto, ReceiveStockDto, StockQueryDto } from './dto/inventory.dto';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { WarehouseService } from './warehouse.service';

const staff: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
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
    };
    controller = new InventoryController(
      inventoryService as unknown as InventoryService,
      warehouseService as unknown as WarehouseService,
      createMockLogger(),
    );
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

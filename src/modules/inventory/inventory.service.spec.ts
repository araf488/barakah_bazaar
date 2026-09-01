import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StockMovementReason, UserRole, StorageType } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminCatalogRepository } from '../admin/admin-catalog.repository';
import { AuthService } from '../auth/auth.service';
import { AdjustStockDto, ReceiveStockDto, StockQueryDto } from './dto/inventory.dto';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

const staff: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.WAREHOUSE,
};

const WAREHOUSE = 'wh-1';
const VARIANT = 'var-1';
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString();

const stockRow = (overrides = {}) => ({
  warehouseId: WAREHOUSE,
  variantId: VARIANT,
  quantityOnHand: 20,
  quantityReserved: 5,
  reorderLevel: 10,
  warehouse: { id: WAREHOUSE, code: 'DHK-GUL' },
  variant: { id: VARIANT, sku: 'ALM-500', nameEn: '500g', product: { nameEn: 'Almonds' } },
  ...overrides,
});

const receiveDto = (overrides: Partial<ReceiveStockDto> = {}): ReceiveStockDto =>
  Object.assign(new ReceiveStockDto(), {
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    quantity: 100,
    ...overrides,
  });

const adjustDto = (overrides: Partial<AdjustStockDto> = {}): AdjustStockDto =>
  Object.assign(new AdjustStockDto(), {
    warehouseId: WAREHOUSE,
    variantId: VARIANT,
    delta: -3,
    reason: StockMovementReason.DAMAGE,
    note: 'Crushed in transit',
    ...overrides,
  });

describe('InventoryService', () => {
  let repository: Record<string, jest.Mock>;
  let catalog: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: InventoryService;

  beforeEach(() => {
    repository = {
      findStock: jest.fn().mockResolvedValue({ quantityOnHand: 20, quantityReserved: 5 }),
      findPage: jest
        .fn()
        .mockResolvedValue({ items: [stockRow()], total: 1, nextExpiry: new Map() }),
      receive: jest.fn().mockResolvedValue({ id: 'batch-1', createdAt: new Date() }),
      adjust: jest.fn().mockResolvedValue({ quantityOnHand: 17 }),
      listMovements: jest.fn().mockResolvedValue([]),
      findWarehouseById: jest.fn().mockResolvedValue({
        id: 'wh-1',
        storageTypes: [StorageType.AMBIENT, StorageType.CHILLED, StorageType.FROZEN],
      }),
    };
    catalog = {
      findVariantById: jest
        .fn()
        .mockResolvedValue({ id: VARIANT, productId: 'p-1', isActive: true }),
      findProductById: jest.fn().mockResolvedValue({
        id: 'p-1',
        isPerishable: false,
        shelfLifeHours: null,
        storageType: StorageType.AMBIENT,
      }),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new InventoryService(
      repository as unknown as InventoryRepository,
      catalog as unknown as AdminCatalogRepository,
      authService as unknown as AuthService,
      logger,
    );
  });

  describe('listStock', () => {
    const query = (overrides: Partial<StockQueryDto> = {}) =>
      Object.assign(new StockQueryDto(), overrides);

    it('computes available as on-hand minus reserved', async () => {
      const result = await service.listStock(query());

      expect(result.ok && result.data.items[0]).toEqual(
        expect.objectContaining({ quantityOnHand: 20, quantityReserved: 5, quantityAvailable: 15 }),
      );
    });

    it('flags a line as low against AVAILABLE, not on-hand', async () => {
      // 20 on hand looks healthy against a reorder level of 18, but 5 are already promised.
      repository.findPage.mockResolvedValue({
        items: [stockRow({ reorderLevel: 18 })],
        total: 1,
        nextExpiry: new Map(),
      });

      const result = await service.listStock(query());

      expect(result.ok && result.data.items[0].isLow).toBe(true);
    });

    it('does not flag a line with no reorder level', async () => {
      repository.findPage.mockResolvedValue({
        items: [stockRow({ reorderLevel: null })],
        total: 1,
        nextExpiry: new Map(),
      });

      const result = await service.listStock(query());

      expect(result.ok && result.data.items[0].isLow).toBe(false);
    });

    it('filters to low stock when asked', async () => {
      repository.findPage.mockResolvedValue({
        items: [stockRow({ reorderLevel: 1 }), stockRow({ variantId: 'v2', reorderLevel: 99 })],
        total: 2,
        nextExpiry: new Map(),
      });

      const result = await service.listStock(query({ lowStockOnly: true }));

      expect(result.ok && result.data.items).toHaveLength(1);
    });

    it('surfaces the earliest expiry for a line', async () => {
      const expiry = new Date('2026-09-05T00:00:00.000Z');
      repository.findPage.mockResolvedValue({
        items: [stockRow()],
        total: 1,
        nextExpiry: new Map([[`${WAREHOUSE}:${VARIANT}`, expiry]]),
      });

      const result = await service.listStock(query());

      expect(result.ok && result.data.items[0].nextExpiryAt).toEqual(expiry);
    });

    it('filters to lines expiring within the horizon', async () => {
      const soon = new Date(Date.now() + 2 * 86_400_000);
      const later = new Date(Date.now() + 60 * 86_400_000);
      repository.findPage.mockResolvedValue({
        items: [stockRow(), stockRow({ variantId: 'v2' })],
        total: 2,
        nextExpiry: new Map([
          [`${WAREHOUSE}:${VARIANT}`, soon],
          [`${WAREHOUSE}:v2`, later],
        ]),
      });

      const result = await service.listStock(query({ expiringWithinDays: 7 }));

      expect(result.ok && result.data.items).toHaveLength(1);
      expect(result.ok && result.data.items[0].variantId).toBe(VARIANT);
    });

    it('answers 503 when the read failed', async () => {
      repository.findPage.mockResolvedValue(null);

      const result = await service.listStock(query());

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('receiveStock', () => {
    it('books a delivery', async () => {
      const result = await service.receiveStock(staff, receiveDto());

      expect(result.ok).toBe(true);
      expect(repository.receive.mock.calls[0][0].quantity).toBe(100);
      expect(repository.receive.mock.calls[0][0].actorId).toBe('user-1');
    });

    it('requires an expiry for a perishable product', async () => {
      // A perishable batch with no expiry cannot be picked first-expiry-first-out, which is
      // the one thing this module exists to do.
      catalog.findProductById.mockResolvedValue({
        id: 'p-1',
        isPerishable: true,
        shelfLifeHours: null,
        storageType: StorageType.AMBIENT,
      });

      const result = await service.receiveStock(staff, receiveDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'This product is perishable, so a receipt must include the batch expiry date.',
      });
      expect(repository.receive).not.toHaveBeenCalled();
    });

    it('accepts a perishable receipt that carries an expiry', async () => {
      catalog.findProductById.mockResolvedValue({
        id: 'p-1',
        isPerishable: true,
        shelfLifeHours: null,
        storageType: StorageType.AMBIENT,
      });

      const result = await service.receiveStock(staff, receiveDto({ expiresAt: TOMORROW }));

      expect(result.ok).toBe(true);
    });

    it('refuses stock that has already expired', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();

      const result = await service.receiveStock(staff, receiveDto({ expiresAt: yesterday }));

      expect(!result.ok && result.message).toBe(
        'The expiry date has already passed. Receive it as a write-off instead.',
      );
    });

    it('refuses an inactive variant', async () => {
      catalog.findVariantById.mockResolvedValue({ id: VARIANT, productId: 'p-1', isActive: false });

      const result = await service.receiveStock(staff, receiveDto());

      expect(!result.ok && result.message).toBe(
        'That product variant does not exist or is inactive.',
      );
    });

    it('converts unit cost to BigInt poysha', async () => {
      await service.receiveStock(staff, receiveDto({ unitCostPoysha: 90000 }));

      expect(repository.receive.mock.calls[0][0].unitCostPoysha).toBe(90000n);
    });
  });

  describe('adjustStock', () => {
    it('applies a correction', async () => {
      const result = await service.adjustStock(staff, adjustDto());

      expect(result.ok).toBe(true);
      expect(repository.adjust.mock.calls[0][0].delta).toBe(-3);
      expect(repository.adjust.mock.calls[0][0].note).toBe('Crushed in transit');
    });

    it('refuses a removal larger than what is on hand', async () => {
      const result = await service.adjustStock(staff, adjustDto({ delta: -50 }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'Only 20 units are on hand. An adjustment cannot take stock below zero.',
      });
      expect(repository.adjust).not.toHaveBeenCalled();
    });

    it('refuses a removal that would eat into reserved stock', async () => {
      // The units are physically there, which is exactly why an adjustment would take them
      // and oversell a checkout already in progress.
      const result = await service.adjustStock(staff, adjustDto({ delta: -18 }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          '5 of the 20 units on hand are reserved for checkouts in progress and cannot be removed.',
      });
    });

    it('allows a removal down to exactly the reserved level', async () => {
      const result = await service.adjustStock(staff, adjustDto({ delta: -15 }));

      expect(result.ok).toBe(true);
    });

    it('never blocks a positive adjustment', async () => {
      const result = await service.adjustStock(staff, adjustDto({ delta: 500 }));

      expect(result.ok).toBe(true);
    });

    it('answers 404 when no stock line exists yet', async () => {
      repository.findStock.mockResolvedValue(undefined);

      const result = await service.adjustStock(staff, adjustDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'No stock has ever been received for this variant at this warehouse.',
      });
    });

    it('passes a disabled staff account through without writing', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      const result = await service.adjustStock(staff, adjustDto());

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(repository.adjust).not.toHaveBeenCalled();
    });
  });

  describe('listMovements', () => {
    it('returns the ledger', async () => {
      repository.listMovements.mockResolvedValue([
        {
          id: 'mv-1',
          delta: -3,
          reason: StockMovementReason.DAMAGE,
          note: 'Crushed',
          actorId: 'user-1',
          referenceType: null,
          referenceId: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.listMovements(WAREHOUSE, VARIANT);

      expect(result.ok && result.data[0].reason).toBe(StockMovementReason.DAMAGE);
    });

    it('answers 503 when the read failed', async () => {
      repository.listMovements.mockResolvedValue(null);

      const result = await service.listMovements(WAREHOUSE, VARIANT);

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('receipt: cold-chain guards', () => {
    const inHours = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    const product = (overrides = {}) => ({
      id: 'p-1',
      isPerishable: true,
      shelfLifeHours: 72,
      storageType: StorageType.CHILLED,
      ...overrides,
    });

    it('refuses an expiry further out than the product can possibly keep', async () => {
      // Not a computed expiry — a ceiling. A date beyond it is a typo, most often a mistyped
      // year, and accepting it would let FEFO hand out spoiled stock last.
      catalog.findProductById.mockResolvedValue(product());

      const result = await service.receiveStock(staff, receiveDto({ expiresAt: inHours(24 * 30) }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message:
          'That expiry is more than 72 hours away, which is longer than this product keeps. Check the date on the batch.',
      });
      expect(repository.receive).not.toHaveBeenCalled();
    });

    it('accepts an expiry inside the shelf life', async () => {
      catalog.findProductById.mockResolvedValue(product());

      const result = await service.receiveStock(staff, receiveDto({ expiresAt: inHours(48) }));

      expect(result.ok).toBe(true);
    });

    it('accepts an expiry sooner than the shelf life, since stock arrives part-used', async () => {
      catalog.findProductById.mockResolvedValue(product());

      const result = await service.receiveStock(staff, receiveDto({ expiresAt: inHours(6) }));

      expect(result.ok).toBe(true);
    });

    it('never computes an expiry from shelf life, only bounds one', async () => {
      catalog.findProductById.mockResolvedValue(product({ isPerishable: false }));

      await service.receiveStock(staff, receiveDto());

      expect(repository.receive.mock.calls[0][0].expiresAt).toBeNull();
    });

    it('skips the check for a product with no declared shelf life', async () => {
      catalog.findProductById.mockResolvedValue(product({ shelfLifeHours: null }));

      const result = await service.receiveStock(
        staff,
        receiveDto({ expiresAt: inHours(24 * 365) }),
      );

      expect(result.ok).toBe(true);
    });

    it('refuses stock a hub cannot hold', async () => {
      // Enforced at receipt, not only at checkout: by checkout the frozen goods are already
      // sitting in a dry room.
      catalog.findProductById.mockResolvedValue(product({ storageType: StorageType.FROZEN }));
      repository.findWarehouseById.mockResolvedValue({
        id: 'wh-1',
        storageTypes: [StorageType.AMBIENT],
      });

      const result = await service.receiveStock(staff, receiveDto({ expiresAt: inHours(24) }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This hub cannot store FROZEN items. Receive them into a hub that can.',
      });
      expect(repository.receive).not.toHaveBeenCalled();
    });

    it('accepts stock into a hub that declares the condition', async () => {
      catalog.findProductById.mockResolvedValue(product({ storageType: StorageType.FROZEN }));
      repository.findWarehouseById.mockResolvedValue({
        id: 'wh-1',
        storageTypes: [StorageType.AMBIENT, StorageType.FROZEN],
      });

      const result = await service.receiveStock(staff, receiveDto({ expiresAt: inHours(24) }));

      expect(result.ok).toBe(true);
    });

    it('reports 404 for a hub that does not exist', async () => {
      catalog.findProductById.mockResolvedValue(product({ isPerishable: false }));
      repository.findWarehouseById.mockResolvedValue(undefined);

      const result = await service.receiveStock(staff, receiveDto());

      expect(result.ok === false && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('reports 503 rather than refusing when the hub cannot be read', async () => {
      catalog.findProductById.mockResolvedValue(product({ isPerishable: false }));
      repository.findWarehouseById.mockResolvedValue(null);

      const result = await service.receiveStock(staff, receiveDto());

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});

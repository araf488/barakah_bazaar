import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { GeoService } from '../geo/geo.service';
import { CreateWarehouseDto, WarehouseQueryDto } from './dto/warehouse.dto';
import { InventoryRepository } from './inventory.repository';
import { WarehouseService } from './warehouse.service';

const boss: AuthenticatedUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: 'session-1',
  email: 'boss@barakahbazaar.com.bd',
  role: UserRole.SUPER_ADMIN,
};

const warehouse = (overrides = {}) => ({
  id: 'wh-1',
  code: 'DHK-GUL',
  nameEn: 'Gulshan Hub',
  nameBn: null,
  division: 'Dhaka',
  district: 'Dhaka',
  upazila: 'Gulshan',
  area: null,
  addressLine: 'House 12',
  postCode: null,
  latitude: null,
  longitude: null,
  serviceRadiusKm: null,
  isActive: true,
  ...overrides,
});

const createDto = (overrides: Partial<CreateWarehouseDto> = {}): CreateWarehouseDto =>
  Object.assign(new CreateWarehouseDto(), {
    code: 'DHK-GUL',
    nameEn: 'Gulshan Hub',
    division: 'Dhaka',
    district: 'Dhaka',
    unit: 'Gulshan',
    addressLine: 'House 12',
    ...overrides,
  });

describe('WarehouseService', () => {
  let repository: Record<string, jest.Mock>;
  let geoService: { validateChain: jest.Mock };
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: WarehouseService;

  beforeEach(() => {
    repository = {
      findWarehouseById: jest.fn().mockResolvedValue(warehouse()),
      findWarehouseByCode: jest.fn().mockResolvedValue(undefined),
      listWarehouses: jest.fn().mockResolvedValue([warehouse()]),
      createWarehouse: jest.fn().mockResolvedValue(warehouse()),
      updateWarehouse: jest.fn().mockResolvedValue(warehouse()),
      deactivateWarehouse: jest.fn().mockResolvedValue({
        kind: 'deactivated',
        warehouse: warehouse({ isActive: false }),
        activeRemaining: 1,
      }),
      reactivateWarehouse: jest.fn().mockResolvedValue({
        kind: 'reactivated',
        warehouse: warehouse(),
        activeRemaining: 2,
      }),
      updateWarehouseStorage: jest.fn().mockResolvedValue({
        kind: 'updated',
        warehouse: warehouse({ storageTypes: ['AMBIENT'] }),
      }),
    };
    geoService = { validateChain: jest.fn().mockReturnValue({ ok: true, data: undefined }) };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new WarehouseService(
      repository as unknown as InventoryRepository,
      geoService as unknown as GeoService,
      authService as unknown as AuthService,
      logger,
    );
  });

  describe('listWarehouses', () => {
    it('hides deactivated hubs by default', async () => {
      await service.listWarehouses(new WarehouseQueryDto());

      expect(repository.listWarehouses).toHaveBeenCalledWith(false);
    });

    it('includes them when asked', async () => {
      await service.listWarehouses(
        Object.assign(new WarehouseQueryDto(), { includeInactive: true }),
      );

      expect(repository.listWarehouses).toHaveBeenCalledWith(true);
    });

    it('surfaces the upazila column as unit, matching the geo endpoints', async () => {
      const result = await service.listWarehouses(new WarehouseQueryDto());

      expect(result.ok && result.data[0].unit).toBe('Gulshan');
      expect(result.ok && result.data[0]).not.toHaveProperty('upazila');
    });
  });

  describe('createWarehouse', () => {
    it('opens a hub', async () => {
      const result = await service.createWarehouse(boss, createDto());

      expect(result.ok && result.data.code).toBe('DHK-GUL');
    });

    it('validates the address against the same dataset a customer address uses', async () => {
      // Delivery routing compares hub and destination; it cannot if they disagree.
      await service.createWarehouse(boss, createDto());

      expect(geoService.validateChain).toHaveBeenCalledWith('Dhaka', 'Dhaka', 'Gulshan', null);
    });

    it('refuses an address that is not a real place', async () => {
      geoService.validateChain.mockReturnValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Nonesuch is not an upazila or thana of Dhaka.',
      });

      const result = await service.createWarehouse(boss, createDto({ unit: 'Nonesuch' }));

      expect(!result.ok && result.status).toBe(HttpStatus.BAD_REQUEST);
      expect(repository.createWarehouse).not.toHaveBeenCalled();
    });

    it('refuses a duplicate code', async () => {
      repository.findWarehouseByCode.mockResolvedValue(warehouse());

      const result = await service.createWarehouse(boss, createDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'A warehouse with the code "DHK-GUL" already exists.',
      });
    });

    it('maps the API unit onto the upazila column', async () => {
      await service.createWarehouse(boss, createDto());

      expect(repository.createWarehouse.mock.calls[0][0].upazila).toBe('Gulshan');
    });

    it('records the creation in the audit trail', async () => {
      await service.createWarehouse(boss, createDto());

      const build = repository.createWarehouse.mock.calls[0][1] as (
        row: unknown,
      ) => Record<string, unknown>;
      const audit = build(warehouse());
      expect(audit.action).toBe('warehouse.created');
      expect(audit.actorId).toBe('user-1');
    });
  });

  describe('updateWarehouse', () => {
    it('revalidates geography when a location field changes', async () => {
      await service.updateWarehouse(boss, 'wh-1', { unit: 'Banani' });

      expect(geoService.validateChain).toHaveBeenCalledWith('Dhaka', 'Dhaka', 'Banani', null);
    });

    it('skips geography validation when nothing locational changed', async () => {
      await service.updateWarehouse(boss, 'wh-1', { nameEn: 'Gulshan Main' });

      expect(geoService.validateChain).not.toHaveBeenCalled();
    });

    it('answers 404 for a hub that does not exist', async () => {
      repository.findWarehouseById.mockResolvedValue(undefined);

      const result = await service.updateWarehouse(boss, 'wh-9', {});

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('deactivateWarehouse', () => {
    it('takes an empty hub out of service', async () => {
      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(result.ok).toBe(true);
      expect(repository.deactivateWarehouse).toHaveBeenCalledWith('wh-1', expect.any(Function));
    });

    it('records the deactivation in the audit trail with the actor', async () => {
      await service.deactivateWarehouse(boss, 'wh-1');

      const build = repository.deactivateWarehouse.mock.calls[0][1] as (
        before: unknown,
        after: unknown,
      ) => Record<string, unknown>;
      const audit = build(warehouse(), warehouse({ isActive: false }));
      expect(audit).toMatchObject({
        action: 'warehouse.deactivated',
        actorId: 'user-1',
        actorEmail: 'boss@barakahbazaar.com.bd',
        actorRole: 'SUPER_ADMIN',
        entityType: 'Warehouse',
        entityId: 'wh-1',
        before: { isActive: true },
        after: { isActive: false },
      });
    });

    it('reports how many active hubs remain after deactivating', async () => {
      repository.deactivateWarehouse.mockResolvedValue({
        kind: 'deactivated',
        warehouse: warehouse({ isActive: false }),
        activeRemaining: 2,
      });

      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(result.ok && result.data).toMatchObject({
        id: 'wh-1',
        isActive: false,
        activeWarehousesRemaining: 2,
      });
    });

    it('refuses the last active hub with 409 and its message', async () => {
      repository.deactivateWarehouse.mockResolvedValue({ kind: 'last-active' });

      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          'This is the only active warehouse. Open or reactivate another hub before taking this one out of service.',
      });
    });

    it('answers 503 when the deactivation transaction faults', async () => {
      repository.deactivateWarehouse.mockResolvedValue(null);

      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('refuses a hub the repository found still holding stock, with 409 and its message', async () => {
      // Those units would vanish from every stock screen while remaining physically present.
      repository.deactivateWarehouse.mockResolvedValue({ kind: 'holds-stock' });

      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This warehouse still holds stock. Transfer or write it off before deactivating.',
      });
    });

    it.each(['CHILLED', 'FROZEN'])(
      'refuses the last active %s-capable hub with 409 and its message',
      async (storageType) => {
        repository.deactivateWarehouse.mockResolvedValue({
          kind: 'last-cold-capable',
          storageType,
        });

        const result = await service.deactivateWarehouse(boss, 'wh-1');

        expect(result).toEqual({
          ok: false,
          status: HttpStatus.CONFLICT,
          message: `This is the only active hub that can store ${storageType} items. Open or reactivate another ${storageType}-capable hub first.`,
        });
      },
    );

    it('leaves the stock check to the locked transaction rather than pre-reading it', async () => {
      await service.deactivateWarehouse(boss, 'wh-1');

      expect(repository).not.toHaveProperty('countStockInWarehouse');
      expect(repository.findWarehouseById).toHaveBeenCalledTimes(1);
      expect(repository.deactivateWarehouse).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when the hub could not be read', async () => {
      repository.findWarehouseById.mockResolvedValue(null);

      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(repository.deactivateWarehouse).not.toHaveBeenCalled();
    });

    it('answers 404 for a hub that does not exist', async () => {
      repository.findWarehouseById.mockResolvedValue(undefined);

      const result = await service.deactivateWarehouse(boss, 'wh-9');

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
      expect(repository.deactivateWarehouse).not.toHaveBeenCalled();
    });
  });
  describe('reactivateWarehouse', () => {
    it('puts a hub back into service and reports the active count', async () => {
      const result = await service.reactivateWarehouse(boss, 'wh-1');

      expect(result).toEqual({
        ok: true,
        data: expect.objectContaining({ id: 'wh-1', isActive: true, activeWarehousesRemaining: 2 }),
      });
      expect(repository.reactivateWarehouse).toHaveBeenCalledWith('wh-1', expect.any(Function));
    });

    it('records the reactivation in the audit trail with the actor and before/after', async () => {
      await service.reactivateWarehouse(boss, 'wh-1');

      const build = repository.reactivateWarehouse.mock.calls[0][1] as (
        before: unknown,
        after: unknown,
      ) => Record<string, unknown>;
      const audit = build(warehouse({ isActive: false }), warehouse());
      expect(audit).toMatchObject({
        action: 'warehouse.reactivated',
        actorId: 'user-1',
        actorEmail: 'boss@barakahbazaar.com.bd',
        actorRole: 'SUPER_ADMIN',
        entityType: 'Warehouse',
        entityId: 'wh-1',
        before: { isActive: false },
        after: { isActive: true },
      });
    });

    it('passes an idempotent reactivation through as 200', async () => {
      repository.reactivateWarehouse.mockResolvedValue({
        kind: 'reactivated',
        warehouse: warehouse(),
        activeRemaining: 1,
      });

      const result = await service.reactivateWarehouse(boss, 'wh-1');

      expect(result.ok && result.data.activeWarehousesRemaining).toBe(1);
    });

    it('answers 404 for a hub that does not exist', async () => {
      repository.findWarehouseById.mockResolvedValue(undefined);

      const result = await service.reactivateWarehouse(boss, 'wh-9');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Warehouse was not found.',
      });
      expect(repository.reactivateWarehouse).not.toHaveBeenCalled();
    });

    it('answers 503 when the hub could not be read', async () => {
      repository.findWarehouseById.mockResolvedValue(null);

      const result = await service.reactivateWarehouse(boss, 'wh-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(repository.reactivateWarehouse).not.toHaveBeenCalled();
    });

    it('answers 503 when the reactivation transaction faults', async () => {
      repository.reactivateWarehouse.mockResolvedValue(null);

      const result = await service.reactivateWarehouse(boss, 'wh-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('passes a disabled staff account through without writing', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      const result = await service.reactivateWarehouse(boss, 'wh-1');

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(repository.findWarehouseById).not.toHaveBeenCalled();
    });

    it('answers 500 and logs when something unexpected throws', async () => {
      repository.reactivateWarehouse.mockRejectedValue(new Error('boom'));

      const result = await service.reactivateWarehouse(boss, 'wh-1');

      expect(!result.ok && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), warehouseId: 'wh-1' },
        'Exception occurred in WarehouseService.reactivateWarehouse',
      );
    });
  });

  describe('updateWarehouse storage conditions', () => {
    it('routes a storageTypes edit through the locked storage path', async () => {
      const result = await service.updateWarehouse(boss, 'wh-1', { storageTypes: ['AMBIENT'] });

      expect(result.ok && result.data.storageTypes).toEqual(['AMBIENT']);
      expect(repository.updateWarehouseStorage).toHaveBeenCalledWith(
        'wh-1',
        { storageTypes: ['AMBIENT'] },
        ['AMBIENT'],
        expect.any(Function),
      );
      expect(repository.updateWarehouse).not.toHaveBeenCalled();
    });

    it('keeps an edit that does not touch storageTypes on the unlocked path', async () => {
      await service.updateWarehouse(boss, 'wh-1', { nameEn: 'Gulshan Main' });

      expect(repository.updateWarehouse).toHaveBeenCalledTimes(1);
      expect(repository.updateWarehouseStorage).not.toHaveBeenCalled();
    });

    it.each(['CHILLED', 'FROZEN'])(
      'refuses dropping %s from the last active hub that holds it with 409',
      async (storageType) => {
        repository.updateWarehouseStorage.mockResolvedValue({
          kind: 'last-cold-capable',
          storageType,
        });

        const result = await service.updateWarehouse(boss, 'wh-1', { storageTypes: ['AMBIENT'] });

        expect(result).toEqual({
          ok: false,
          status: HttpStatus.CONFLICT,
          message: `This is the only active hub that can store ${storageType} items. Open or reactivate another ${storageType}-capable hub first.`,
        });
      },
    );

    it('answers 503 when the storage edit transaction faults', async () => {
      repository.updateWarehouseStorage.mockResolvedValue(null);

      const result = await service.updateWarehouse(boss, 'wh-1', { storageTypes: ['AMBIENT'] });

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('audits the storage edit with the locked row as before', async () => {
      await service.updateWarehouse(boss, 'wh-1', { storageTypes: ['AMBIENT'] });

      const build = repository.updateWarehouseStorage.mock.calls[0][3] as (
        before: unknown,
        after: unknown,
      ) => Record<string, unknown>;
      const audit = build(
        warehouse({ storageTypes: ['AMBIENT', 'CHILLED'] }),
        warehouse({ storageTypes: ['AMBIENT'] }),
      );
      expect(audit).toMatchObject({
        action: 'warehouse.updated',
        actorId: 'user-1',
        entityId: 'wh-1',
        before: { storageTypes: ['AMBIENT', 'CHILLED'] },
        after: { storageTypes: ['AMBIENT'] },
      });
    });
  });
});

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
      countStockInWarehouse: jest.fn().mockResolvedValue(0),
      createWarehouse: jest.fn().mockResolvedValue(warehouse()),
      updateWarehouse: jest.fn().mockResolvedValue(warehouse()),
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
      expect(repository.updateWarehouse.mock.calls[0][1]).toEqual({ isActive: false });
    });

    it('refuses while stock is still on its shelves', async () => {
      // Those units would vanish from every stock screen while remaining physically present.
      repository.countStockInWarehouse.mockResolvedValue(42);

      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This warehouse still holds stock. Transfer or write it off before deactivating.',
      });
      expect(repository.updateWarehouse).not.toHaveBeenCalled();
    });

    it('answers 503 when the stock count could not be read', async () => {
      repository.countStockInWarehouse.mockResolvedValue(null);

      const result = await service.deactivateWarehouse(boss, 'wh-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});

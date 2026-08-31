import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { serviceFail, serviceOk } from '../../common/types/service-response';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { GeoService } from '../geo/geo.service';
import { AdminDeliveryService } from './admin-delivery.service';
import { DeliveryRepository } from './delivery.repository';

const staff: AuthenticatedUser = {
  supabaseUserId: 'sub-1',
  role: UserRole.OPS,
  email: 'ops@barakahbazaar.com.bd',
};

const zoneRow = (overrides = {}) => ({
  id: 'zone-1',
  nameEn: 'Inside Dhaka',
  nameBn: null,
  feePoysha: 6000n,
  freeAbovePoysha: null,
  isDefault: false,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  rules: [],
  ...overrides,
});

describe('AdminDeliveryService', () => {
  let repository: {
    findAll: jest.Mock;
    findById: jest.Mock;
    findDefault: jest.Mock;
    findConflictingRules: jest.Mock;
    createAudited: jest.Mock;
    updateAudited: jest.Mock;
  };
  let geo: {
    validateChain: jest.Mock;
    validateDistrict: jest.Mock;
    validateDivision: jest.Mock;
  };
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AdminDeliveryService;

  beforeEach(() => {
    repository = {
      findAll: jest.fn(),
      findById: jest.fn().mockResolvedValue(zoneRow()),
      findDefault: jest.fn().mockResolvedValue(undefined),
      findConflictingRules: jest.fn().mockResolvedValue([]),
      createAudited: jest.fn().mockResolvedValue(zoneRow()),
      updateAudited: jest.fn().mockResolvedValue(zoneRow()),
    };
    geo = {
      validateChain: jest.fn().mockReturnValue(serviceOk<void>(undefined)),
      validateDistrict: jest.fn().mockReturnValue(serviceOk<void>(undefined)),
      validateDivision: jest.fn().mockReturnValue(serviceOk<void>(undefined)),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new AdminDeliveryService(
      repository as unknown as DeliveryRepository,
      geo as unknown as GeoService,
      authService as unknown as AuthService,
      logger,
    );
  });

  const dto = (overrides = {}) => ({
    nameEn: 'Inside Dhaka',
    feePoysha: 6000,
    rules: [{ division: 'Dhaka', district: 'Dhaka', unit: 'Gulshan' }],
    ...overrides,
  });

  describe('validating places against the geo dataset', () => {
    it('checks the full chain for a rule naming a unit', async () => {
      await service.create(staff, dto());

      expect(geo.validateChain).toHaveBeenCalledWith('Dhaka', 'Dhaka', 'Gulshan');
    });

    it('checks only division and district when no unit is named', async () => {
      await service.create(staff, dto({ rules: [{ division: 'Dhaka', district: 'Dhaka' }] }));

      expect(geo.validateDistrict).toHaveBeenCalledWith('Dhaka', 'Dhaka');
      expect(geo.validateChain).not.toHaveBeenCalled();
    });

    it('checks only the division for a division-wide rule', async () => {
      await service.create(staff, dto({ rules: [{ division: 'Dhaka' }] }));

      expect(geo.validateDivision).toHaveBeenCalledWith('Dhaka');
    });

    it('refuses a typo that would silently never match', async () => {
      // A misspelled district matches no address and quietly bills everyone the default rate.
      geo.validateChain.mockReturnValue(serviceFail(HttpStatus.BAD_REQUEST, 'nope'));

      const result = await service.create(staff, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'That place is not in the address dataset. Check the spelling.',
      });
      expect(repository.createAudited).not.toHaveBeenCalled();
    });
  });

  describe('rule shape', () => {
    it('refuses a unit with no district, which cannot be resolved', async () => {
      const result = await service.create(
        staff,
        dto({ rules: [{ division: 'Dhaka', unit: 'Gulshan' }] }),
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'A rule naming a unit must also name its district.',
      });
    });
  });

  describe('overlap', () => {
    it('refuses a place another zone already claims', async () => {
      repository.findConflictingRules.mockResolvedValue([
        {
          id: 'rule-x',
          zoneId: 'zone-other',
          division: 'Dhaka',
          district: 'Dhaka',
          unit: 'Gulshan',
        },
      ]);

      const result = await service.create(staff, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That place already belongs to another delivery zone.',
      });
    });

    it('allows a zone to keep its own existing rules on update', async () => {
      repository.findConflictingRules.mockResolvedValue([
        { id: 'rule-x', zoneId: 'zone-1', division: 'Dhaka', district: 'Dhaka', unit: 'Gulshan' },
      ]);

      const result = await service.update(staff, 'zone-1', dto());

      expect(result.ok).toBe(true);
    });
  });

  describe('the default zone', () => {
    it('refuses a second default, which would make the fee row-order dependent', async () => {
      repository.findDefault.mockResolvedValue(zoneRow({ id: 'zone-other', isDefault: true }));

      const result = await service.create(staff, dto({ isDefault: true }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'Another zone is already the default. Clear it before marking this one.',
      });
    });

    it('lets the existing default stay default on its own update', async () => {
      repository.findDefault.mockResolvedValue(zoneRow({ id: 'zone-1', isDefault: true }));

      const result = await service.update(staff, 'zone-1', dto({ isDefault: true }));

      expect(result.ok).toBe(true);
    });

    it('does not check for a default when the zone is not claiming to be one', async () => {
      await service.create(staff, dto());

      expect(repository.findDefault).not.toHaveBeenCalled();
    });
  });

  describe('writes', () => {
    it('converts money to BigInt poysha', async () => {
      await service.create(staff, dto({ feePoysha: 6000, freeAbovePoysha: 200000 }));

      expect(repository.createAudited.mock.calls[0][0]).toMatchObject({
        feePoysha: 6000n,
        freeAbovePoysha: 200000n,
      });
    });

    it('treats an omitted threshold as never free', async () => {
      await service.create(staff, dto());

      expect(repository.createAudited.mock.calls[0][0].freeAbovePoysha).toBeNull();
    });

    it('refuses the change when its audit row cannot be written', async () => {
      repository.createAudited.mockResolvedValue(null);

      const result = await service.create(staff, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not record this change in the audit trail, so it was not applied.',
      });
    });

    it('leaves the rule set untouched when the update did not send one', async () => {
      await service.update(staff, 'zone-1', { nameEn: 'Renamed', feePoysha: 6000 });

      expect(repository.updateAudited.mock.calls[0][2]).toBeNull();
    });

    it('replaces the whole rule set when one is sent', async () => {
      await service.update(staff, 'zone-1', dto());

      expect(repository.updateAudited.mock.calls[0][2]).toEqual([
        { division: 'Dhaka', district: 'Dhaka', unit: 'Gulshan' },
      ]);
    });

    it('reports 404 for a zone that does not exist', async () => {
      repository.findById.mockResolvedValue(undefined);

      const result = await service.update(staff, 'zone-1', dto());

      expect(result.ok === false && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('list', () => {
    it('maps money out as numbers', async () => {
      repository.findAll.mockResolvedValue([zoneRow({ freeAbovePoysha: 200000n })]);

      const result = await service.list(false);

      expect(result.ok && result.data[0]).toMatchObject({
        feePoysha: 6000,
        freeAbovePoysha: 200000,
      });
    });

    it('reports 503 when the zones cannot be read', async () => {
      repository.findAll.mockResolvedValue(null);

      const result = await service.list(false);

      expect(result.ok).toBe(false);
    });
  });
});

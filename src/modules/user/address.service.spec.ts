import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { addressFixture } from '../../../test/support/user-fixtures';
import { AuthService } from '../auth/auth.service';
import { GeoService } from '../geo/geo.service';
import { AddressRepository } from './address.repository';
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

const authenticated: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.CUSTOMER,
};

const createDto = (overrides: Partial<CreateAddressDto> = {}): CreateAddressDto =>
  Object.assign(new CreateAddressDto(), {
    label: 'Home',
    recipientName: 'Rahim Uddin',
    phone: '01712345678',
    division: 'Dhaka',
    district: 'Dhaka',
    unit: 'Savar',
    area: 'Birulia',
    addressLine: 'House 12, Road 4',
    ...overrides,
  });

const updateDto = (overrides: Partial<UpdateAddressDto> = {}): UpdateAddressDto =>
  Object.assign(new UpdateAddressDto(), overrides);

describe('AddressService', () => {
  let repository: {
    findAllForUser: jest.Mock;
    findOneForUser: jest.Mock;
    countForUser: jest.Mock;
    create: jest.Mock;
    updateForUser: jest.Mock;
    softDeleteForUser: jest.Mock;
    promoteDefault: jest.Mock;
  };
  let authService: { resolveActiveUserId: jest.Mock };
  let geoService: { validateChain: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AddressService;

  beforeEach(() => {
    repository = {
      findAllForUser: jest.fn(),
      findOneForUser: jest.fn(),
      countForUser: jest.fn(),
      create: jest.fn(),
      updateForUser: jest.fn(),
      softDeleteForUser: jest.fn(),
      promoteDefault: jest.fn(),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    geoService = { validateChain: jest.fn().mockReturnValue({ ok: true, data: undefined }) };
    logger = createMockLogger();
    service = new AddressService(
      repository as unknown as AddressRepository,
      authService as unknown as AuthService,
      geoService as unknown as GeoService,
      logger,
    );
  });

  describe('listAddresses', () => {
    it('returns the mapped list', async () => {
      repository.findAllForUser.mockResolvedValue([addressFixture()]);

      const result = await service.listAddresses(authenticated);

      expect(result.ok && result.data[0].id).toBe('address-1');
    });

    it('returns an empty list rather than a 404 for a customer with no addresses', async () => {
      repository.findAllForUser.mockResolvedValue([]);

      await expect(service.listAddresses(authenticated)).resolves.toEqual({ ok: true, data: [] });
    });

    it('answers 503 when the read failed', async () => {
      repository.findAllForUser.mockResolvedValue(null);

      const result = await service.listAddresses(authenticated);

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('passes a disabled-account 403 through without reading', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      const result = await service.listAddresses(authenticated);

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(repository.findAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('getAddress', () => {
    it('returns the address', async () => {
      repository.findOneForUser.mockResolvedValue(addressFixture());

      const result = await service.getAddress(authenticated, 'address-1');

      expect(result.ok && result.data.id).toBe('address-1');
    });

    it("answers 404 for another customer's address id", async () => {
      repository.findOneForUser.mockResolvedValue(undefined);

      expect(await service.getAddress(authenticated, 'address-9')).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Address was not found.',
      });
    });

    it('answers 503, not 404, when the read failed', async () => {
      repository.findOneForUser.mockResolvedValue(null);

      const result = await service.getAddress(authenticated, 'address-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('createAddress', () => {
    beforeEach(() => {
      repository.countForUser.mockResolvedValue(0);
      repository.create.mockResolvedValue(addressFixture());
    });

    it('creates and returns the address', async () => {
      const result = await service.createAddress(authenticated, createDto());

      expect(result.ok && result.data.id).toBe('address-1');
    });

    it('validates the whole geography chain before writing', async () => {
      await service.createAddress(authenticated, createDto());

      expect(geoService.validateChain).toHaveBeenCalledWith('Dhaka', 'Dhaka', 'Savar', 'Birulia');
    });

    it('refuses a broken chain with the message naming the failing link', async () => {
      geoService.validateChain.mockReturnValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Gulshan is not an area of Savar.',
      });

      const result = await service.createAddress(authenticated, createDto({ area: 'Gulshan' }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Gulshan is not an area of Savar.',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('normalizes the phone number to the stored E.164 form', async () => {
      await service.createAddress(authenticated, createDto({ phone: '01712345678' }));

      expect(repository.create.mock.calls[0][1].phone).toBe('+8801712345678');
    });

    it('maps the API field unit onto the upazila column', async () => {
      await service.createAddress(authenticated, createDto({ unit: 'Gulshan' }));

      expect(repository.create.mock.calls[0][1].upazila).toBe('Gulshan');
    });

    it('stores map-pin coordinates when supplied', async () => {
      await service.createAddress(
        authenticated,
        createDto({ latitude: 23.7925, longitude: 90.4078 }),
      );

      const data = repository.create.mock.calls[0][1];
      expect(data.latitude).toBeCloseTo(23.7925, 4);
      expect(data.longitude).toBeCloseTo(90.4078, 4);
    });

    it('writes absent optional fields as null rather than undefined', async () => {
      await service.createAddress(
        authenticated,
        createDto({ label: undefined, area: undefined, postCode: undefined, latitude: undefined }),
      );

      const data = repository.create.mock.calls[0][1];
      expect(data.label).toBeNull();
      expect(data.area).toBeNull();
      expect(data.postCode).toBeNull();
      expect(data.latitude).toBeNull();
    });

    it('answers 409 naming the cap when the address book is full', async () => {
      repository.countForUser.mockResolvedValue(20);

      const result = await service.createAddress(authenticated, createDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'You can save at most 20 addresses. Remove one before adding another.',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('allows the twentieth address', async () => {
      repository.countForUser.mockResolvedValue(19);

      const result = await service.createAddress(authenticated, createDto());

      expect(result.ok).toBe(true);
    });

    it('answers 503 when the count could not be read', async () => {
      repository.countForUser.mockResolvedValue(null);

      const result = await service.createAddress(authenticated, createDto());

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('answers 500 and logs when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.countForUser.mockRejectedValue(failure);

      const result = await service.createAddress(authenticated, createDto());

      expect(!result.ok && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in AddressService.createAddress',
      );
    });
  });

  describe('updateAddress', () => {
    beforeEach(() => {
      repository.findOneForUser.mockResolvedValue(addressFixture());
      repository.updateForUser.mockResolvedValue(addressFixture());
    });

    it('applies the patch and returns the updated address', async () => {
      repository.updateForUser.mockResolvedValue(addressFixture({ recipientName: 'Karim Mia' }));

      const result = await service.updateAddress(
        authenticated,
        'address-1',
        updateDto({ recipientName: 'Karim Mia' }),
      );

      expect(result.ok && result.data.recipientName).toBe('Karim Mia');
    });

    it('does not touch geography validation when no geo field was sent', async () => {
      await service.updateAddress(authenticated, 'address-1', updateDto({ label: 'Office' }));

      expect(geoService.validateChain).not.toHaveBeenCalled();
    });

    it('merges a partial geo change onto the stored row before validating', async () => {
      await service.updateAddress(authenticated, 'address-1', updateDto({ area: 'Kaundia' }));

      expect(geoService.validateChain).toHaveBeenCalledWith('Dhaka', 'Dhaka', 'Savar', 'Kaundia');
    });

    it('refuses a patch that breaks the chain, without writing', async () => {
      geoService.validateChain.mockReturnValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Gulshan is not an area of Savar.',
      });

      const result = await service.updateAddress(
        authenticated,
        'address-1',
        updateDto({ area: 'Gulshan' }),
      );

      expect(!result.ok && result.message).toBe('Gulshan is not an area of Savar.');
      expect(repository.updateForUser).not.toHaveBeenCalled();
    });

    it('normalizes a patched phone number', async () => {
      await service.updateAddress(authenticated, 'address-1', updateDto({ phone: '01812345678' }));

      expect(repository.updateForUser.mock.calls[0][2].phone).toBe('+8801812345678');
    });

    it('leaves untouched fields undefined so Prisma does not overwrite them', async () => {
      await service.updateAddress(authenticated, 'address-1', updateDto({ label: 'Office' }));

      const data = repository.updateForUser.mock.calls[0][2];
      expect(data.label).toBe('Office');
      expect(data.recipientName).toBeUndefined();
      expect(data.phone).toBeUndefined();
    });

    it("answers 404 for another customer's address", async () => {
      repository.findOneForUser.mockResolvedValue(undefined);

      const result = await service.updateAddress(authenticated, 'address-9', updateDto({}));

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
      expect(repository.updateForUser).not.toHaveBeenCalled();
    });

    it('answers 404 when the row disappeared between the read and the write', async () => {
      repository.updateForUser.mockResolvedValue(undefined);

      const result = await service.updateAddress(authenticated, 'address-1', updateDto({}));

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('answers 503 when the write failed', async () => {
      repository.updateForUser.mockResolvedValue(null);

      const result = await service.updateAddress(authenticated, 'address-1', updateDto({}));

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('deleteAddress', () => {
    it('succeeds with no payload', async () => {
      repository.softDeleteForUser.mockResolvedValue(addressFixture());

      await expect(service.deleteAddress(authenticated, 'address-1')).resolves.toEqual({
        ok: true,
        data: undefined,
      });
    });

    it("answers 404 for another customer's address", async () => {
      repository.softDeleteForUser.mockResolvedValue(undefined);

      expect(await service.deleteAddress(authenticated, 'address-9')).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Address was not found.',
      });
    });

    it('answers 503 when the delete failed', async () => {
      repository.softDeleteForUser.mockResolvedValue(null);

      const result = await service.deleteAddress(authenticated, 'address-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('setDefaultAddress', () => {
    it('returns the promoted address', async () => {
      repository.promoteDefault.mockResolvedValue(addressFixture({ id: 'address-2' }));

      const result = await service.setDefaultAddress(authenticated, 'address-2');

      expect(result.ok && result.data.id).toBe('address-2');
    });

    it('succeeds unchanged when the address is already the default', async () => {
      repository.promoteDefault.mockResolvedValue(addressFixture({ isDefault: true }));

      const result = await service.setDefaultAddress(authenticated, 'address-1');

      expect(result.ok && result.data.isDefault).toBe(true);
    });

    it('promotes through a single repository call, so the write stays one transaction', async () => {
      repository.promoteDefault.mockResolvedValue(addressFixture());

      await service.setDefaultAddress(authenticated, 'address-1');

      expect(repository.promoteDefault).toHaveBeenCalledTimes(1);
      expect(repository.promoteDefault).toHaveBeenCalledWith('user-1', 'address-1');
    });

    it("answers 404 for another customer's address", async () => {
      repository.promoteDefault.mockResolvedValue(undefined);

      const result = await service.setDefaultAddress(authenticated, 'address-9');

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('answers 503 when the promotion failed', async () => {
      repository.promoteDefault.mockResolvedValue(null);

      const result = await service.setDefaultAddress(authenticated, 'address-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});

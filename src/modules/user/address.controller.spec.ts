import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

const authenticated: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.CUSTOMER,
};

const validPayload = {
  recipientName: 'Rahim Uddin',
  phone: '01712345678',
  division: 'Dhaka',
  district: 'Dhaka',
  unit: 'Savar',
  addressLine: 'House 12, Road 4',
};

const body = (overrides: Partial<CreateAddressDto> = {}): CreateAddressDto =>
  Object.assign(new CreateAddressDto(), validPayload, overrides);

describe('AddressController', () => {
  let addressService: {
    listAddresses: jest.Mock;
    getAddress: jest.Mock;
    createAddress: jest.Mock;
    updateAddress: jest.Mock;
    deleteAddress: jest.Mock;
    setDefaultAddress: jest.Mock;
  };
  let controller: AddressController;

  beforeEach(() => {
    addressService = {
      listAddresses: jest.fn(),
      getAddress: jest.fn(),
      createAddress: jest.fn(),
      updateAddress: jest.fn(),
      deleteAddress: jest.fn(),
      setDefaultAddress: jest.fn(),
    };
    controller = new AddressController(
      addressService as unknown as AddressService,
      createMockLogger(),
    );
  });

  describe('list', () => {
    it('returns the list on success', async () => {
      addressService.listAddresses.mockResolvedValue({ ok: true, data: [{ id: 'address-1' }] });

      await expect(controller.list(authenticated)).resolves.toEqual([{ id: 'address-1' }]);
    });

    it('refuses a request with no verified caller', async () => {
      await expect(controller.list(undefined)).rejects.toThrow(UnauthorizedException);
      expect(addressService.listAddresses).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('returns the created address', async () => {
      addressService.createAddress.mockResolvedValue({ ok: true, data: { id: 'address-1' } });

      await expect(controller.create(authenticated, body())).resolves.toEqual({
        id: 'address-1',
      });
    });

    it('surfaces the cap message on 409', async () => {
      addressService.createAddress.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'You can save at most 20 addresses. Remove one before adding another.',
      });

      await expect(controller.create(authenticated, body())).rejects.toThrow(
        'You can save at most 20 addresses. Remove one before adding another.',
      );
    });

    it('surfaces a geography failure as 400', async () => {
      addressService.createAddress.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Gulshan is not an area of Savar.',
      });

      await expect(controller.create(authenticated, body())).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('get', () => {
    it('passes the id through', async () => {
      addressService.getAddress.mockResolvedValue({ ok: true, data: {} });

      await controller.get(authenticated, 'address-1');

      expect(addressService.getAddress).toHaveBeenCalledWith(authenticated, 'address-1');
    });

    it("answers 404 for another customer's address", async () => {
      addressService.getAddress.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Address was not found.',
      });

      await expect(controller.get(authenticated, 'address-9')).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('update', () => {
    it('returns the updated address', async () => {
      addressService.updateAddress.mockResolvedValue({ ok: true, data: { id: 'address-1' } });

      await expect(controller.update(authenticated, 'address-1', {})).resolves.toEqual({
        id: 'address-1',
      });
    });

    it('passes a failure through as an HTTP error', async () => {
      addressService.updateAddress.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Address was not found.',
      });

      await expect(controller.update(authenticated, 'address-9', {})).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('remove', () => {
    it('resolves with nothing on success', async () => {
      addressService.deleteAddress.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.remove(authenticated, 'address-1')).resolves.toBeUndefined();
    });

    it('answers 404 for an address that is not the caller’s', async () => {
      addressService.deleteAddress.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Address was not found.',
      });

      await expect(controller.remove(authenticated, 'address-9')).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('setDefault', () => {
    it('returns the promoted address', async () => {
      addressService.setDefaultAddress.mockResolvedValue({
        ok: true,
        data: { id: 'address-2', isDefault: true },
      });

      await expect(controller.setDefault(authenticated, 'address-2')).resolves.toEqual({
        id: 'address-2',
        isDefault: true,
      });
    });
  });

  describe('CreateAddressDto validation', () => {
    it('accepts a complete payload', async () => {
      await expect(validate(plainToInstance(CreateAddressDto, validPayload))).resolves.toEqual([]);
    });

    it.each(['recipientName', 'phone', 'division', 'district', 'unit', 'addressLine'])(
      'rejects an absent %s',
      async (field) => {
        const payload: Record<string, unknown> = { ...validPayload };
        delete payload[field];

        await expect(validate(plainToInstance(CreateAddressDto, payload))).resolves.not.toEqual([]);
      },
    );

    it.each(['recipientName', 'division', 'district', 'unit', 'addressLine'])(
      'rejects an empty %s',
      async (field) => {
        const dto = plainToInstance(CreateAddressDto, { ...validPayload, [field]: '' });

        await expect(validate(dto)).resolves.not.toEqual([]);
      },
    );

    it('reports one error per required field when the payload is empty', async () => {
      const errors = await validate(plainToInstance(CreateAddressDto, {}));

      expect(errors.map((error) => error.property).sort((a, b) => a.localeCompare(b))).toEqual([
        'addressLine',
        'district',
        'division',
        'phone',
        'recipientName',
        'unit',
      ]);
    });

    it('rejects a non-Bangladeshi phone number', async () => {
      const errors = await validate(
        plainToInstance(CreateAddressDto, { ...validPayload, phone: '+14155552671' }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].constraints?.matches).toBe('phone must be a Bangladeshi mobile number');
    });

    it('rejects a post code that is not four digits', async () => {
      const dto = plainToInstance(CreateAddressDto, { ...validPayload, postCode: '17040' });

      await expect(validate(dto)).resolves.not.toEqual([]);
    });

    it('rejects coordinates outside the valid range', async () => {
      const dto = plainToInstance(CreateAddressDto, { ...validPayload, latitude: 999 });

      await expect(validate(dto)).resolves.not.toEqual([]);
    });

    it('accepts a map pin', async () => {
      const dto = plainToInstance(CreateAddressDto, {
        ...validPayload,
        latitude: 23.7925,
        longitude: 90.4078,
      });

      await expect(validate(dto)).resolves.toEqual([]);
    });

    it('trims free text before validating', () => {
      const dto = plainToInstance(CreateAddressDto, {
        ...validPayload,
        recipientName: '  Rahim Uddin  ',
      });

      expect(dto.recipientName).toBe('Rahim Uddin');
    });
  });

  describe('UpdateAddressDto null handling', () => {
    // These shipped broken: PartialType's default @IsOptional() skips null as well as
    // undefined, so {"phone": null} reached the service and threw a 500, and
    // {"recipientName": null} reached a NOT NULL column and surfaced as a 503.
    it.each(['recipientName', 'phone', 'division', 'district', 'unit', 'addressLine'])(
      'rejects an explicit null %s with a validation error, not a 500',
      async (field) => {
        const dto = plainToInstance(UpdateAddressDto, { [field]: null });

        await expect(validate(dto)).resolves.not.toEqual([]);
      },
    );

    it('accepts an explicit null area, which clears it', async () => {
      // Needed to move an address to a city thana that has no areas beneath it.
      const dto = plainToInstance(UpdateAddressDto, { area: null });

      await expect(validate(dto)).resolves.toEqual([]);
      expect(dto.area).toBeNull();
    });

    it('still validates a supplied area', async () => {
      const dto = plainToInstance(UpdateAddressDto, { area: '' });

      await expect(validate(dto)).resolves.not.toEqual([]);
    });

    it('leaves an omitted field undefined so Prisma will not touch it', () => {
      const dto = plainToInstance(UpdateAddressDto, { label: 'Office' });

      expect(dto.area).toBeUndefined();
      expect(dto.recipientName).toBeUndefined();
    });
  });
});

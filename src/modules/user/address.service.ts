import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { BangladeshPhone } from '../../common/phone/bangladesh-phone';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Address } from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import { GeoService } from '../geo/geo.service';
import {
  AddressCreateData,
  AddressRepository,
  AddressResult,
  AddressUpdateData,
} from './address.repository';
import { AddressDto } from './dto/address-response.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UserConstants, UserMessages } from './user.constants';
import { UserMapper } from './user.mapper';

/**
 * The delivery address book.
 *
 * The owner is always the local user id resolved from the verified token; the `:id` in the
 * path is never trusted on its own, so another customer's address id yields 404 rather than
 * their data.
 *
 * Geography is validated as a CHAIN through GeoService — four individually valid names that
 * do not compose is the characteristic bug, and only a chain check catches it. Map-pin
 * coordinates are stored as supplied but never influence that validation.
 */
@Injectable()
export class AddressService {
  constructor(
    private readonly repository: AddressRepository,
    private readonly authService: AuthService,
    private readonly geoService: GeoService,
    @InjectPinoLogger(AddressService.name) private readonly logger: PinoLogger,
  ) {}

  async listAddresses(authenticated: AuthenticatedUser): Promise<ServiceResponse<AddressDto[]>> {
    try {
      const owner = await this.authService.resolveActiveUserId(authenticated);

      if (!owner.ok) {
        return owner;
      }

      const addresses = await this.repository.findAllForUser(owner.data);

      if (addresses === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(UserMapper.toAddressList(addresses));
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId },
        'Exception occurred in AddressService.listAddresses',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async getAddress(
    authenticated: AuthenticatedUser,
    id: string,
  ): Promise<ServiceResponse<AddressDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(authenticated);

      if (!owner.ok) {
        return owner;
      }

      return AddressService.toAddressResponse(await this.repository.findOneForUser(owner.data, id));
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId, addressId: id },
        'Exception occurred in AddressService.getAddress',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async createAddress(
    authenticated: AuthenticatedUser,
    dto: CreateAddressDto,
  ): Promise<ServiceResponse<AddressDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(authenticated);

      if (!owner.ok) {
        return owner;
      }

      const geography = this.geoService.validateChain(
        dto.division,
        dto.district,
        dto.unit,
        dto.area,
      );

      if (!geography.ok) {
        return geography;
      }

      const existing = await this.repository.countForUser(owner.data);

      if (existing === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      // Checked here rather than inside the insert transaction: the cap is spam prevention,
      // not an invariant, so a rare concurrent 21st address is a better trade than pushing a
      // business rule down into the repository.
      if (existing >= UserConstants.MaxAddressesPerUser) {
        return serviceFail(
          HttpStatus.CONFLICT,
          formatMessage(
            UserMessages.AddressLimitReachedTemplate,
            String(UserConstants.MaxAddressesPerUser),
          ),
        );
      }

      const created = await this.repository.create(owner.data, AddressService.toCreateData(dto));

      if (created === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(UserMapper.toAddress(created));
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId },
        'Exception occurred in AddressService.createAddress',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateAddress(
    authenticated: AuthenticatedUser,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<ServiceResponse<AddressDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(authenticated);

      if (!owner.ok) {
        return owner;
      }

      const existing = await this.repository.findOneForUser(owner.data, id);

      if (!existing) {
        return AddressService.toAddressResponse(existing);
      }

      const geography = this.validateMergedGeography(existing, dto);

      if (!geography.ok) {
        return geography;
      }

      return AddressService.toAddressResponse(
        await this.repository.updateForUser(owner.data, id, AddressService.toUpdateData(dto)),
      );
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId, addressId: id },
        'Exception occurred in AddressService.updateAddress',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async deleteAddress(
    authenticated: AuthenticatedUser,
    id: string,
  ): Promise<ServiceResponse<void>> {
    try {
      const owner = await this.authService.resolveActiveUserId(authenticated);

      if (!owner.ok) {
        return owner;
      }

      const deleted = await this.repository.softDeleteForUser(owner.data, id);

      if (deleted === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (deleted === undefined) {
        return AddressService.addressNotFound();
      }

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId, addressId: id },
        'Exception occurred in AddressService.deleteAddress',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async setDefaultAddress(
    authenticated: AuthenticatedUser,
    id: string,
  ): Promise<ServiceResponse<AddressDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(authenticated);

      if (!owner.ok) {
        return owner;
      }

      return AddressService.toAddressResponse(await this.repository.promoteDefault(owner.data, id));
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId, addressId: id },
        'Exception occurred in AddressService.setDefaultAddress',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Turns the repository's three-valued result into a response: a row, a 404 for "not yours
   * or not there", or a 503 for "the query failed".
   */
  private static toAddressResponse(address: AddressResult): ServiceResponse<AddressDto> {
    if (address === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (address === undefined) {
      return AddressService.addressNotFound();
    }

    return serviceOk(UserMapper.toAddress(address));
  }

  private static addressNotFound<TData>(): ServiceResponse<TData> {
    return serviceFail(
      HttpStatus.NOT_FOUND,
      formatMessage(ErrorMessageTemplates.NotFound, UserConstants.AddressResourceName),
    );
  }

  /**
   * A patch may change one link of the chain, so validation runs on the merged values —
   * changing only the area must not skip the check that it still belongs to the stored unit.
   */
  private validateMergedGeography(existing: Address, dto: UpdateAddressDto): ServiceResponse<void> {
    const touchesGeography =
      dto.division !== undefined ||
      dto.district !== undefined ||
      dto.unit !== undefined ||
      dto.area !== undefined;

    if (!touchesGeography) {
      return serviceOk<void>(undefined);
    }

    return this.geoService.validateChain(
      dto.division ?? existing.division,
      dto.district ?? existing.district,
      dto.unit ?? existing.upazila,
      dto.area ?? existing.area,
    );
  }

  private static toCreateData(dto: CreateAddressDto): AddressCreateData {
    return {
      label: dto.label ?? null,
      recipientName: dto.recipientName,
      phone: BangladeshPhone.normalize(dto.phone),
      division: dto.division,
      district: dto.district,
      upazila: dto.unit,
      area: dto.area ?? null,
      addressLine: dto.addressLine,
      postCode: dto.postCode ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    };
  }

  /**
   * Fields the client left out stay `undefined`, which Prisma reads as "do not touch" — so a
   * partial patch cannot blank a column it never mentioned.
   */
  private static toUpdateData(dto: UpdateAddressDto): AddressUpdateData {
    return {
      label: dto.label,
      recipientName: dto.recipientName,
      phone: dto.phone === undefined ? undefined : BangladeshPhone.normalize(dto.phone),
      division: dto.division,
      district: dto.district,
      upazila: dto.unit,
      area: dto.area,
      addressLine: dto.addressLine,
      postCode: dto.postCode,
      latitude: dto.latitude,
      longitude: dto.longitude,
    };
  }
}

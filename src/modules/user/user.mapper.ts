import { Address } from '../../infra/prisma/prisma-client';
import { AddressDto } from './dto/address-response.dto';

/**
 * Address rows to the wire contract.
 *
 * The field list is written out rather than spread, so adding a column to the table never
 * silently publishes it — `deletedAt` and `userId` in particular must never leave the
 * server.
 *
 * The `upazila` column surfaces as `unit`, matching what `/geo/districts/:district/units`
 * returns; the column name predates city-thana coverage.
 *
 * Profile mapping lives in AuthMapper, next to UserProfileDto, so `/auth/me` and
 * `PATCH /users/me` cannot drift apart.
 */
export const UserMapper = {
  toAddress(address: Address): AddressDto {
    return {
      id: address.id,
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      division: address.division,
      district: address.district,
      unit: address.upazila,
      area: address.area,
      addressLine: address.addressLine,
      postCode: address.postCode,
      latitude: address.latitude,
      longitude: address.longitude,
      isDefault: address.isDefault,
      createdAt: address.createdAt,
      updatedAt: address.updatedAt,
    };
  },

  toAddressList(addresses: readonly Address[]): AddressDto[] {
    return addresses.map((address) => UserMapper.toAddress(address));
  },
} as const;

import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { UserConstants } from '../user.constants';
import { CreateAddressDto } from './create-address.dto';

/**
 * A partial edit. Fields left out are left alone — Prisma reads `undefined` in `data` as
 * "do not touch", so a patch cannot blank a column it never mentioned.
 *
 * `skipNullProperties: false` matters. `PartialType`'s default applies `@IsOptional()`, which
 * skips validation for `null` as well as `undefined` — so `{"phone": null}` reached the
 * service and `BangladeshPhone.normalize(null)` threw a TypeError surfacing as a 500, and
 * `{"recipientName": null}` reached a NOT NULL column and surfaced as a 503. With this
 * option, `null` is validated like any other value and both are a 400.
 *
 * `PartialType` comes from `@nestjs/swagger` rather than `@nestjs/mapped-types` so the
 * OpenAPI metadata survives; the storefront generates its client from that document.
 *
 * Geography is still validated as a whole: the service merges the patch onto the stored row
 * before asking GeoService, so changing only the area cannot slip a broken chain past.
 */
export class UpdateAddressDto extends PartialType(
  // `area` is re-declared below as nullable, which the base type does not permit; omitting
  // it here keeps the override honest instead of widening the create contract.
  OmitType(CreateAddressDto, ['area'] as const),
  { skipNullProperties: false },
) {
  /**
   * The one field where an explicit `null` is meaningful: it CLEARS the stored area.
   *
   * Needed to move an address to a city thana that has no areas beneath it — 28 units in the
   * dataset are in that position, including Banani, Badda and Adabor. Without this the
   * customer's only recourse was to delete and recreate the address, losing its default flag.
   */
  @ApiPropertyOptional({
    nullable: true,
    maxLength: UserConstants.MaxGeoNameLength,
    description: 'Union or post-office area. Send null to clear it.',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  area?: string | null;
}

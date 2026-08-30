import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { BANGLADESH_MOBILE_PATTERN } from '../../../common/phone/bangladesh-phone';
import { POST_CODE_PATTERN, UserConstants } from '../user.constants';

/**
 * A new delivery address.
 *
 * No `isDefault`: the first address a customer saves becomes the default automatically, and
 * every later change goes through `PUT /users/me/addresses/:id/default`. One invariant, one
 * write path.
 *
 * Geography is shape-checked here and chain-checked by GeoService in the service layer —
 * four individually valid names that do not compose is the failure this DTO cannot see.
 *
 * `latitude`/`longitude` come from the map pin and are supplementary: they never determine
 * the administrative address, which is always validated against the vendored dataset.
 */
export class CreateAddressDto {
  @ApiPropertyOptional({ maxLength: UserConstants.MaxLabelLength, example: 'Home' })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxLabelLength)
  label?: string;

  @ApiProperty({ maxLength: UserConstants.MaxRecipientNameLength, example: 'Rahim Uddin' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxRecipientNameLength)
  recipientName!: string;

  @ApiProperty({ example: '01712345678', description: 'Local or +880 form; stored as +880' })
  @TrimString()
  @IsString()
  @Matches(BANGLADESH_MOBILE_PATTERN, { message: 'phone must be a Bangladeshi mobile number' })
  phone!: string;

  @ApiProperty({ maxLength: UserConstants.MaxGeoNameLength, example: 'Dhaka' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  division!: string;

  @ApiProperty({ maxLength: UserConstants.MaxGeoNameLength, example: 'Dhaka' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  district!: string;

  @ApiProperty({
    maxLength: UserConstants.MaxGeoNameLength,
    example: 'Gulshan',
    description: 'Upazila, city thana or circle, as listed by /geo/districts/:district/units',
  })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  unit!: string;

  @ApiPropertyOptional({
    maxLength: UserConstants.MaxGeoNameLength,
    example: 'Gulshan Model Town',
    description: 'Union or post-office area. Omit for a city thana that has none.',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  area?: string;

  @ApiProperty({ maxLength: UserConstants.MaxAddressLineLength, example: 'House 12, Road 4' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxAddressLineLength)
  addressLine!: string;

  @ApiPropertyOptional({ example: '1212', description: 'Four-digit Bangladeshi post code' })
  @IsOptional()
  @TrimString()
  @IsString()
  @Matches(POST_CODE_PATTERN, { message: 'postCode must be four digits' })
  postCode?: string;

  @ApiPropertyOptional({
    example: 23.7925,
    description: 'From the map pin. Never trusted for the administrative address.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 90.4078 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

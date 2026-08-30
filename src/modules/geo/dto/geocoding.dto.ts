import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { GeoConstants } from '../geo.constants';

/** Free-text place search, for the map pin on the address form. */
export class GeoSearchQueryDto {
  @ApiProperty({ minLength: GeoConstants.SearchMinLength, example: 'Gulshan 2 Circle' })
  @TrimString()
  @IsString()
  @MinLength(GeoConstants.SearchMinLength)
  @MaxLength(GeoConstants.SearchMaxLength)
  q!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: GeoConstants.SearchMaxLimit,
    default: GeoConstants.SearchDefaultLimit,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(GeoConstants.SearchMaxLimit)
  limit: number = GeoConstants.SearchDefaultLimit;
}

/** Reverse geocode a dropped pin. */
export class GeoReverseQueryDto {
  @ApiProperty({ example: 23.7925 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 90.4078 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

/**
 * A place the geocoder returned.
 *
 * Only `latitude`/`longitude` are ever stored on an address; `label` is shown back to the
 * customer for confirmation, and the administrative address always comes from the vendored
 * dataset instead.
 */
export class GeocodedPlaceDto {
  @ApiProperty({ example: 'গুলশান ১, ঢাকা' }) label!: string;
  @ApiProperty({ example: 23.7925 }) latitude!: number;
  @ApiProperty({ example: 90.4078 }) longitude!: number;
  @ApiPropertyOptional({ nullable: true, example: '1212' }) postCode?: string | null;
}

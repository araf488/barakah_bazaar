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

/** A pasted Google Maps link, or a bare "lat, lng" pair. */
export class GeoResolveLinkDto {
  @ApiProperty({
    example: 'https://maps.app.goo.gl/abc123',
    description: 'A Google Maps URL, a share link, or "23.7925, 90.4078"',
  })
  @TrimString()
  @IsString()
  @MinLength(GeoConstants.SearchMinLength)
  @MaxLength(GeoConstants.PastedLinkMaxLength)
  link!: string;
}

/** What a pasted link resolved to. */
export class ResolvedLocationDto {
  @ApiProperty({ example: 23.7925 }) latitude!: number;
  @ApiProperty({ example: 90.4078 }) longitude!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Reverse-geocoded description, when a provider is configured',
  })
  label!: string | null;
  @ApiPropertyOptional({ nullable: true }) postCode!: string | null;
}

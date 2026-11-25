import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoAreaKind, GeoUnitKind } from '../bangladesh-geo.data';

/**
 * Every geography payload carries both languages so one call renders in either.
 *
 * `nameBn` is nullable below district level: the Dhaka Metropolitan Police and post-office
 * sources are English-only, and a Bengali spelling is never invented to fill the gap.
 */
export class GeoDivisionDto {
  @ApiProperty({ example: 'Dhaka' }) nameEn!: string;
  @ApiProperty({ example: 'ঢাকা' }) nameBn!: string;
  @ApiProperty({ example: 13 }) districtCount!: number;
}

export class GeoDistrictDto {
  @ApiProperty({ example: 'Gazipur' }) nameEn!: string;
  @ApiProperty({ example: 'গাজীপুর' }) nameBn!: string;
  @ApiProperty({ example: 'Dhaka' }) divisionEn!: string;
  @ApiProperty({ example: 5 }) unitCount!: number;
}

/** An upazila, a city thana, or a development circle — the level below a district. */
export class GeoUnitDto {
  @ApiProperty({ example: 'Gulshan' }) nameEn!: string;
  @ApiPropertyOptional({ nullable: true, example: 'গুলশান' }) nameBn!: string | null;
  @ApiProperty({ enum: ['upazila', 'thana', 'circle'] }) kind!: GeoUnitKind;
  @ApiProperty({ example: 'Dhaka' }) districtEn!: string;
  @ApiProperty({ example: 2 }) areaCount!: number;
}

/** The level a customer actually picks. */
export class GeoAreaDto {
  @ApiProperty({ example: 'Donia' }) nameEn!: string;
  @ApiPropertyOptional({ nullable: true, example: 'দনিয়া' }) nameBn!: string | null;
  @ApiProperty({ enum: ['union', 'postcode-area'] }) kind!: GeoAreaKind;
  @ApiPropertyOptional({ nullable: true, example: '1236' }) postCode!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 23.7 }) latitude!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 90.4 }) longitude!: number | null;
}

/** Every area of one unit, with its place in the chain. */
export class GeoAreaListDto {
  @ApiProperty({ example: 'Dhaka' }) divisionEn!: string;
  @ApiProperty({ example: 'Dhaka' }) districtEn!: string;
  @ApiProperty({ example: 'Savar' }) unitEn!: string;
  @ApiProperty({ type: [GeoAreaDto] }) areas!: GeoAreaDto[];
}

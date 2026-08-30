import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { POST_CODE_PATTERN, UserConstants } from '../../user/user.constants';
import { InventoryConstants } from '../inventory.constants';

/**
 * A place stock physically sits.
 *
 * The address uses the same four geography levels as a customer address and is validated
 * against the same vendored dataset — delivery routing has to compare hub and destination,
 * and it cannot do that if they speak different vocabularies.
 */
export class CreateWarehouseDto {
  @ApiProperty({
    example: 'DHK-GUL',
    description: 'Short code used on labels and pick lists. Uppercase, digits and hyphens.',
  })
  @TrimString()
  // Uppercased so 'dhk-gul' and 'DHK-GUL' cannot become two hubs with the same code.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, {
    message: 'code must be uppercase letters, digits and single hyphens',
  })
  @MaxLength(InventoryConstants.MaxWarehouseCodeLength)
  code!: string;

  @ApiProperty({ example: 'Gulshan Hub' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxRecipientNameLength)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'গুলশান হাব' })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxRecipientNameLength)
  nameBn?: string | null;

  @ApiProperty({ example: 'Dhaka' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  division!: string;

  @ApiProperty({ example: 'Dhaka' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  district!: string;

  @ApiProperty({ example: 'Gulshan', description: 'Upazila, city thana or circle' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  unit!: string;

  @ApiPropertyOptional({ example: 'Gulshan Model Town' })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxGeoNameLength)
  area?: string | null;

  @ApiProperty({ example: 'House 12, Road 4' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxAddressLineLength)
  addressLine!: string;

  @ApiPropertyOptional({ example: '1212' })
  @IsOptional()
  @TrimString()
  @IsString()
  @Matches(POST_CODE_PATTERN, { message: 'postCode must be four digits' })
  postCode?: string | null;

  @ApiPropertyOptional({ example: 23.7925 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number | null;

  @ApiPropertyOptional({ example: 90.4078 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number | null;

  @ApiPropertyOptional({ description: 'How far this hub will deliver, in kilometres' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceRadiusKm?: number | null;
}

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto, {
  skipNullProperties: false,
}) {}

export class WarehouseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameEn!: string;
  @ApiPropertyOptional({ nullable: true }) nameBn!: string | null;
  @ApiProperty() division!: string;
  @ApiProperty() district!: string;
  @ApiProperty({ description: 'Upazila, city thana or circle' }) unit!: string;
  @ApiPropertyOptional({ nullable: true }) area!: string | null;
  @ApiProperty() addressLine!: string;
  @ApiPropertyOptional({ nullable: true }) postCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) latitude!: number | null;
  @ApiPropertyOptional({ nullable: true }) longitude!: number | null;
  @ApiPropertyOptional({ nullable: true }) serviceRadiusKm!: number | null;
  @ApiProperty() isActive!: boolean;
}

export class WarehouseQueryDto {
  @ApiPropertyOptional({ description: 'Include deactivated hubs' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { DeliveryConstants } from '../delivery.constants';

export class ZoneRuleDto {
  @ApiProperty({ description: 'Division name, as it appears in the geography dataset.' })
  @TrimString()
  @IsString()
  @MaxLength(80)
  division!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Null means the whole division.' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(80)
  district?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Upazila, city thana or circle. Null means the whole district.',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(80)
  unit?: string | null;
}

export class UpsertZoneDto {
  @ApiProperty()
  @TrimString()
  @IsString()
  @MaxLength(DeliveryConstants.MaxZoneNameLength)
  nameEn!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(DeliveryConstants.MaxZoneNameLength)
  nameBn?: string | null;

  @ApiProperty({ description: 'Flat fee in poysha. 0 means free delivery in this zone.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  feePoysha!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Subtotal in poysha at or above which delivery is free here.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  freeAbovePoysha?: number | null;

  @ApiPropertyOptional({ description: 'Used when no rule matches. Only one zone may be default.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [ZoneRuleDto], description: 'Replaces the whole rule set.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DeliveryConstants.MaxRulesPerZone)
  @ValidateNested({ each: true })
  @Type(() => ZoneRuleDto)
  rules?: ZoneRuleDto[];
}

export class DeliveryZoneDto {
  @ApiProperty() id!: string;
  @ApiProperty() nameEn!: string;
  @ApiPropertyOptional({ nullable: true }) nameBn!: string | null;
  @ApiProperty() feePoysha!: number;
  @ApiPropertyOptional({ nullable: true }) freeAbovePoysha!: number | null;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: [ZoneRuleDto] }) rules!: ZoneRuleDto[];
}

/** What delivering one basket to one address costs, and why. */
export class DeliveryQuoteDto {
  @ApiProperty() feePoysha!: number;
  @ApiProperty({ description: 'The zone the address resolved to.' }) zoneNameEn!: string;
  @ApiPropertyOptional({ nullable: true }) zoneNameBn!: string | null;
  @ApiProperty({ description: 'True when the fee was waived by the free-delivery threshold.' })
  isFree!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'How much more the basket needs for free delivery. Null when unavailable here.',
  })
  freeDeliveryShortfallPoysha!: number | null;
}

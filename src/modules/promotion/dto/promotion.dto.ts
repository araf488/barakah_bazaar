import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PromotionType } from '../../../infra/prisma/prisma-client';
import { TrimString } from '../../../common/dto/trim.decorator';
import { PromotionConstants } from '../promotion.constants';

export class UpsertPromotionDto {
  @ApiProperty({ description: 'Uppercased on write. EID25 and eid25 are the same code.' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PromotionConstants.MaxCodeLength)
  code!: string;

  @ApiProperty()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PromotionConstants.MaxNameLength)
  nameEn!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(PromotionConstants.MaxNameLength)
  nameBn?: string | null;

  @ApiProperty({ enum: PromotionType })
  @IsEnum(PromotionType)
  type!: PromotionType;

  @ApiProperty({
    description:
      'Whole percent (1-100) for PERCENTAGE, poysha for FIXED_AMOUNT, 0 for FREE_DELIVERY.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  value!: number;

  @ApiPropertyOptional({ description: 'Basket value required, in poysha. 0 means no minimum.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSubtotalPoysha?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ceiling on a percentage discount, in poysha. Null is uncapped.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDiscountPoysha?: number | null;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  startsAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Total redemptions allowed. Null is unlimited.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Per customer. Null is unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perCustomerLimit?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PreviewPromotionDto {
  @ApiProperty()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PromotionConstants.MaxCodeLength)
  code!: string;

  @ApiProperty({ description: 'Basket value in poysha.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  subtotalPoysha!: number;

  @ApiPropertyOptional({ description: 'Delivery fee in poysha, for FREE_DELIVERY codes.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deliveryFeePoysha?: number;
}

export class PromotionDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameEn!: string;
  @ApiPropertyOptional({ nullable: true }) nameBn!: string | null;
  @ApiProperty({ enum: PromotionType }) type!: PromotionType;
  @ApiProperty() value!: number;
  @ApiProperty() minSubtotalPoysha!: number;
  @ApiPropertyOptional({ nullable: true }) maxDiscountPoysha!: number | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  endsAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) usageLimit!: number | null;
  @ApiPropertyOptional({ nullable: true }) perCustomerLimit!: number | null;
  @ApiProperty() isActive!: boolean;
}

/** What a code is worth on this basket, for the storefront to show before checkout. */
export class PromotionPreviewDto {
  @ApiProperty() code!: string;
  @ApiProperty() nameEn!: string;
  @ApiPropertyOptional({ nullable: true }) nameBn!: string | null;
  @ApiProperty() discountPoysha!: number;
}

export class PromotionListDto {
  @ApiProperty({ type: [PromotionDto] }) items!: PromotionDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

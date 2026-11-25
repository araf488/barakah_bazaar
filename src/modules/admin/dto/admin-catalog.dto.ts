import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { PricingMode, StorageType } from '../../../infra/prisma/prisma-client';
import { AdminConstants } from '../admin.constants';

/** Poysha is an integer; a price is never fractional. 1 BDT = 100 poysha. */
const MAX_PRICE_POYSHA = 100_000_000;

export class CreateCategoryDto {
  @ApiProperty({ example: 'dry-fruits', maxLength: AdminConstants.MaxSlugLength })
  @TrimString()
  @IsString()
  @Matches(AdminConstants.SlugPattern, {
    message: 'slug must be lowercase letters, digits and single hyphens',
  })
  @MaxLength(AdminConstants.MaxSlugLength)
  slug!: string;

  @ApiProperty({ example: 'Dry Fruits', maxLength: AdminConstants.MaxNameLength })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxNameLength)
  nameEn!: string;

  @ApiProperty({ example: 'শুকনো ফল', maxLength: AdminConstants.MaxNameLength })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxNameLength)
  nameBn!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Parent category, for a subcategory' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  imageUrl?: string | null;

  @ApiPropertyOptional({ default: 0, description: 'Lower sorts first' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto, {
  skipNullProperties: false,
}) {}

export class CreateProductDto {
  @ApiProperty({ example: 'premium-almonds', maxLength: AdminConstants.MaxSlugLength })
  @TrimString()
  @IsString()
  @Matches(AdminConstants.SlugPattern, {
    message: 'slug must be lowercase letters, digits and single hyphens',
  })
  @MaxLength(AdminConstants.MaxSlugLength)
  slug!: string;

  @ApiProperty({ maxLength: AdminConstants.MaxNameLength })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxNameLength)
  nameEn!: string;

  @ApiProperty({ maxLength: AdminConstants.MaxNameLength })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxNameLength)
  nameBn!: string;

  @ApiPropertyOptional({ maxLength: AdminConstants.MaxDescriptionLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(AdminConstants.MaxDescriptionLength)
  descriptionEn?: string | null;

  @ApiPropertyOptional({ maxLength: AdminConstants.MaxDescriptionLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(AdminConstants.MaxDescriptionLength)
  descriptionBn?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @ApiPropertyOptional({ maxLength: AdminConstants.MaxBrandLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(AdminConstants.MaxBrandLength)
  brand?: string | null;

  @ApiPropertyOptional({ enum: PricingMode, default: PricingMode.UNIT })
  @IsOptional()
  @IsEnum(PricingMode)
  pricingMode?: PricingMode;

  @ApiPropertyOptional({ default: false, description: 'Doi, rosmalai, fresh fruit' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isPerishable?: boolean;

  @ApiPropertyOptional({ description: 'Hours from dispatch. Required for perishables.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shelfLifeHours?: number | null;

  @ApiPropertyOptional({ enum: StorageType, default: StorageType.AMBIENT })
  @IsOptional()
  @IsEnum(StorageType)
  storageType?: StorageType;

  @ApiPropertyOptional({ description: 'Cold-chain radius limit, in kilometres' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDeliveryDistanceKm?: number | null;
}

export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {}

export class CreateVariantDto {
  @ApiProperty({ maxLength: AdminConstants.MaxSkuLength, example: 'ALM-500' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxSkuLength)
  sku!: string;

  @ApiProperty({ maxLength: AdminConstants.MaxNameLength })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxNameLength)
  nameEn!: string;

  @ApiProperty({ maxLength: AdminConstants.MaxNameLength })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxNameLength)
  nameBn!: string;

  @ApiProperty({
    example: 125000,
    description: 'Selling price in POYSHA, not taka. 1 BDT = 100 poysha.',
  })
  @Type(() => Number)
  @IsInt({ message: 'pricePoysha must be a whole number of poysha' })
  @Min(1)
  @Max(MAX_PRICE_POYSHA)
  pricePoysha!: number;

  @ApiPropertyOptional({ description: 'The "was" price, in poysha. Must exceed pricePoysha.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_POYSHA)
  compareAtPricePoysha?: number | null;

  @ApiPropertyOptional({
    description: 'Net weight. Required when the product is priced by weight.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  weightGrams?: number | null;

  @ApiProperty({ example: '500g', maxLength: AdminConstants.MaxUnitLabelLength })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxUnitLabelLength)
  unitLabel!: string;
}

export class UpdateVariantDto extends PartialType(CreateVariantDto, {
  skipNullProperties: false,
}) {}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PricingMode, StorageType } from '../../../infra/prisma/prisma-client';

/** A node in the category tree. */
export class CategoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() nameBn!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl?: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: () => [CategoryResponseDto] }) children!: CategoryResponseDto[];
}

export class ProductImageDto {
  @ApiProperty() url!: string;
  @ApiPropertyOptional({ nullable: true }) altText?: string | null;
  @ApiProperty() isPrimary!: boolean;
}

/**
 * A sellable SKU. `pricePoysha` is the integer contract every client must
 * calculate with; `priceFormatted` is display sugar only.
 */
export class ProductVariantDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() nameBn!: string;
  @ApiProperty({ description: 'Price in poysha (1 BDT = 100 poysha)' }) pricePoysha!: number;
  @ApiPropertyOptional({ nullable: true }) compareAtPricePoysha?: number | null;
  @ApiProperty({ example: '৳1,250.00' }) priceFormatted!: string;
  @ApiPropertyOptional({ nullable: true }) weightGrams?: number | null;
  @ApiProperty({ example: '500g' }) unitLabel!: string;
  @ApiProperty() isDefault!: boolean;
}

/** Perishability facts the storefront needs to explain delivery constraints. */
export class ProductHandlingDto {
  @ApiProperty() isPerishable!: boolean;
  @ApiProperty({ enum: StorageType }) storageType!: StorageType;
  @ApiPropertyOptional({ nullable: true }) shelfLifeHours?: number | null;
  @ApiPropertyOptional({ nullable: true }) maxDeliveryDistanceKm?: number | null;
}

/** Compact shape for grid and search results. */
/** A product's published rating. */
export class ProductRatingDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Null when nothing has been published yet — not the same as zero stars.',
  })
  average!: number | null;

  @ApiProperty({ description: 'How many published reviews the average is over.' })
  count!: number;
}

export class ProductListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() nameBn!: string;
  @ApiPropertyOptional({ nullable: true }) brand?: string | null;
  @ApiProperty({ enum: PricingMode }) pricingMode!: PricingMode;
  @ApiProperty({ description: 'Cheapest active variant price, in poysha' })
  fromPricePoysha!: number;
  @ApiProperty() fromPriceFormatted!: string;
  @ApiPropertyOptional({ nullable: true, type: ProductImageDto })
  primaryImage?: ProductImageDto | null;
  @ApiProperty({ type: ProductHandlingDto }) handling!: ProductHandlingDto;
  @ApiProperty({ type: ProductRatingDto }) rating!: ProductRatingDto;
}

/** Full product detail page. */
export class ProductDetailDto extends ProductListItemDto {
  @ApiPropertyOptional({ nullable: true }) descriptionEn?: string | null;
  @ApiPropertyOptional({ nullable: true }) descriptionBn?: string | null;
  @ApiProperty() categorySlug!: string;
  @ApiProperty({ type: [ProductVariantDto] }) variants!: ProductVariantDto[];
  @ApiProperty({ type: [ProductImageDto] }) images!: ProductImageDto[];
}

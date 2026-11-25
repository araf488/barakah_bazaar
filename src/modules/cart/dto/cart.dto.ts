import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { CartConstants } from '../cart.constants';

/**
 * One basket line.
 *
 * Both prices are exposed on purpose. `unitPricePoysha` is what the customer would pay now;
 * `unitPricePoyshaAtAdd` is what it cost when they added it. When they differ, `priceChanged`
 * is true and the storefront shows the difference before checkout — a price that moved
 * silently is the thing customers notice on the receipt and dispute.
 */
export class CartItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) variantId!: string;
  @ApiProperty({ example: 'ALM-500' }) sku!: string;
  @ApiProperty({ example: 'Premium Almonds' }) productNameEn!: string;
  @ApiProperty({ example: 'প্রিমিয়াম কাঠবাদাম' }) productNameBn!: string;
  @ApiProperty({ example: '500g' }) variantNameEn!: string;
  @ApiProperty({ example: 'premium-almonds' }) productSlug!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: 'Live price, in poysha' }) unitPricePoysha!: number;
  @ApiProperty({ description: 'Price when this was added, in poysha' })
  unitPricePoyshaAtAdd!: number;
  @ApiProperty({ description: 'True when the live price differs from the added price' })
  priceChanged!: boolean;
  @ApiProperty({ description: 'quantity × live unit price, in poysha' })
  lineTotalPoysha!: number;
  @ApiProperty({ example: '৳1,250.00' }) lineTotalFormatted!: string;
  @ApiProperty({ description: 'Units that can still be sold right now' })
  availableQuantity!: number;
  @ApiProperty({ description: 'True when the basket asks for more than is available' })
  exceedsStock!: boolean;
}

export class CartDto {
  @ApiProperty({ type: [CartItemDto] }) items!: CartItemDto[];
  @ApiProperty({ description: 'Sum of the line totals, at live prices' })
  subtotalPoysha!: number;
  @ApiProperty({ example: '৳3,400.00' }) subtotalFormatted!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ description: 'True when any line moved in price since it was added' })
  hasPriceChanges!: boolean;
  @ApiProperty({ description: 'True when any line asks for more than is in stock' })
  hasStockIssues!: boolean;
}

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: CartConstants.MaxQuantityPerLine })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CartConstants.MaxQuantityPerLine)
  quantity!: number;
}

export class UpdateCartItemDto {
  @ApiProperty({
    example: 3,
    minimum: 1,
    description: 'Absolute quantity, not a delta. Send DELETE to remove the line.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CartConstants.MaxQuantityPerLine)
  quantity!: number;
}

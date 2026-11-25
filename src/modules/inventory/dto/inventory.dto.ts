import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { StockMovementReason } from '../../../infra/prisma/prisma-client';
import { InventoryConstants } from '../inventory.constants';

/** One stock line, as the warehouse sees it. */
export class StockLineDto {
  @ApiProperty({ format: 'uuid' }) variantId!: string;
  @ApiProperty({ example: 'ALM-500' }) sku!: string;
  @ApiProperty({ example: 'Premium Almonds' }) productNameEn!: string;
  @ApiProperty({ example: '500g' }) variantNameEn!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ example: 'DHK-GUL' }) warehouseCode!: string;
  @ApiProperty() quantityOnHand!: number;
  @ApiProperty({ description: 'Held for checkouts in progress' }) quantityReserved!: number;
  @ApiProperty({ description: 'onHand minus reserved — what can still be sold' })
  quantityAvailable!: number;
  @ApiPropertyOptional({ nullable: true }) reorderLevel!: number | null;
  @ApiProperty({ description: 'True when available has fallen to or below the reorder level' })
  isLow!: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Earliest expiry still in stock' })
  nextExpiryAt!: Date | null;
}

export class StockQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Only lines at or below their reorder level' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  lowStockOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only lines with a batch expiring within N days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  expiringWithinDays?: number;
}

/** Booking a delivery of stock into a warehouse. */
export class ReceiveStockDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ example: 120, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(InventoryConstants.MaxMovementQuantity)
  quantity!: number;

  @ApiPropertyOptional({ description: "The supplier's lot number, when they give one" })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(InventoryConstants.MaxBatchCodeLength)
  batchCode?: string | null;

  @ApiPropertyOptional({ description: 'Required for perishables. ISO 8601.' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @ApiPropertyOptional({ description: 'Purchase cost per unit in poysha, for margin reporting' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitCostPoysha?: number | null;

  @ApiPropertyOptional({ maxLength: InventoryConstants.MaxNoteLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(InventoryConstants.MaxNoteLength)
  note?: string | null;
}

/**
 * A correction. Positive adds, negative removes.
 *
 * `reason` is mandatory and constrained: an unexplained adjustment is indistinguishable from
 * theft, and the whole point of the ledger is that a discrepancy can be accounted for.
 */
export class AdjustStockDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ example: -3, description: 'Signed. Positive adds, negative removes.' })
  @Type(() => Number)
  @IsInt()
  @Min(-InventoryConstants.MaxMovementQuantity)
  @Max(InventoryConstants.MaxMovementQuantity)
  delta!: number;

  @ApiProperty({
    enum: [
      StockMovementReason.ADJUSTMENT,
      StockMovementReason.DAMAGE,
      StockMovementReason.EXPIRY,
      StockMovementReason.RETURN,
    ],
  })
  @IsEnum(StockMovementReason)
  reason!: StockMovementReason;

  @ApiProperty({ maxLength: InventoryConstants.MaxNoteLength, description: 'Why. Required.' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(InventoryConstants.MaxNoteLength)
  note!: string;
}

export class StockMovementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() delta!: number;
  @ApiProperty({ enum: StockMovementReason }) reason!: StockMovementReason;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiPropertyOptional({ nullable: true }) actorId!: string | null;
  @ApiPropertyOptional({ nullable: true }) referenceType!: string | null;
  @ApiPropertyOptional({ nullable: true }) referenceId!: string | null;
  @ApiProperty() createdAt!: Date;
}

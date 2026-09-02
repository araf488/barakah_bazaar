import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { DeliveryConstants } from '../delivery.constants';
import { MINUTES_PER_DAY } from '../slot-availability';

export class UpsertSlotDto {
  @ApiProperty({ format: 'uuid', description: 'The hub whose van runs this window.' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ example: 'Morning 9-11' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DeliveryConstants.MaxZoneNameLength)
  labelEn!: string;

  @ApiPropertyOptional({ nullable: true, example: 'সকাল ৯-১১' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(DeliveryConstants.MaxZoneNameLength)
  labelBn?: string | null;

  @ApiProperty({ minimum: 0, maximum: MINUTES_PER_DAY, description: '9am is 540.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_PER_DAY)
  startMinute!: number;

  @ApiProperty({ minimum: 0, maximum: MINUTES_PER_DAY, description: '11am is 660.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_PER_DAY)
  endMinute!: number;

  @ApiProperty({
    type: [Number],
    description: 'Weekdays this window runs. 0 = Sunday, 6 = Saturday.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @ApiProperty({ minimum: 1, description: 'Orders this window can take, per day.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity!: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Orders close this many minutes before the window opens.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cutoffMinutes?: number;

  @ApiPropertyOptional({ description: 'Whether this van has cold transport.' })
  @IsOptional()
  @IsBoolean()
  supportsPerishable?: boolean;

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
}

export class SlotQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Which saved address the order goes to.' })
  @IsUUID()
  addressId!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: DeliveryConstants.MaxSlotHorizonDays,
    default: DeliveryConstants.SlotHorizonDays,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DeliveryConstants.MaxSlotHorizonDays)
  days?: number;
}

/** One window on one date, with what is left of it. */
export class SlotOccurrenceDto {
  @ApiProperty({ format: 'uuid' }) slotId!: string;
  @ApiProperty({ format: 'date', description: 'yyyy-mm-dd, local.' }) date!: string;
  @ApiProperty({ description: 'Minutes from midnight.' }) startMinute!: number;
  @ApiProperty() endMinute!: number;
  @ApiProperty({ description: 'Places left in this window on this date.' }) remaining!: number;
  @ApiProperty() supportsPerishable!: boolean;
}

export class DeliverySlotDto {
  @ApiProperty() id!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() labelEn!: string;
  @ApiPropertyOptional({ nullable: true }) labelBn!: string | null;
  @ApiProperty() startMinute!: number;
  @ApiProperty() endMinute!: number;
  @ApiProperty({ type: [Number] }) daysOfWeek!: number[];
  @ApiProperty() capacity!: number;
  @ApiProperty() cutoffMinutes!: number;
  @ApiProperty() supportsPerishable!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

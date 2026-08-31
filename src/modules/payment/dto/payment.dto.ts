import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import {
  PaymentDirection,
  PaymentMethod,
  PaymentTransactionStatus,
} from '../../../infra/prisma/prisma-client';
import { TrimString } from '../../../common/dto/trim.decorator';

export class CollectCashDto {
  @ApiPropertyOptional({
    description:
      'Amount actually collected, in poysha. Omit to collect the full outstanding balance.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountPoysha?: number;

  @ApiPropertyOptional({ description: 'Free-text note, e.g. a receipt book number.' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class RefundOrderDto {
  @ApiPropertyOptional({
    description: 'Amount to refund, in poysha. Omit to refund everything still captured.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountPoysha?: number;

  @ApiPropertyOptional({ description: 'Why the money is going back.' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class PaymentQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class PaymentTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ enum: PaymentDirection }) direction!: PaymentDirection;
  @ApiProperty({ enum: PaymentTransactionStatus }) status!: PaymentTransactionStatus;
  @ApiProperty({ description: 'Always positive. The direction says which way it went.' })
  amountPoysha!: number;
  @ApiPropertyOptional({ nullable: true }) gatewayReference!: string | null;
  @ApiPropertyOptional({ nullable: true }) failureReason!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  capturedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class OrderPaymentSummaryDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() totalPoysha!: number;
  @ApiProperty() capturedPoysha!: number;
  @ApiProperty() refundedPoysha!: number;
  @ApiProperty({ description: 'What is still owed: total minus captured, plus refunds.' })
  outstandingPoysha!: number;
  @ApiProperty({ type: [PaymentTransactionDto] }) transactions!: PaymentTransactionDto[];
}

export class PaymentListDto {
  @ApiProperty({ type: [PaymentTransactionDto] }) items!: PaymentTransactionDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

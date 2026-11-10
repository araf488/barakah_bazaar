import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PaymentDirection,
  PaymentMethod,
  PaymentTransactionStatus,
} from '../../../infra/prisma/prisma-client';
import { TrimString } from '../../../common/dto/trim.decorator';
import { PaymentConstants, RefundClaimOutcome, RefundClaimOutcomes } from '../payment.constants';

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

  @ApiPropertyOptional({
    enum: PaymentTransactionStatus,
    description: 'With `direction=REFUND`, `PENDING` lists automatic bKash refund claims.',
  })
  @IsOptional()
  @IsEnum(PaymentTransactionStatus)
  status?: PaymentTransactionStatus;

  @ApiPropertyOptional({ enum: PaymentDirection })
  @IsOptional()
  @IsEnum(PaymentDirection)
  direction?: PaymentDirection;
}

export class ResolveRefundClaimDto {
  @ApiProperty({
    enum: Object.values(RefundClaimOutcomes),
    description:
      'What the bKash merchant portal shows for the charge: `refunded` completes the claim, ' +
      '`not-refunded` releases it so the reconciliation sweep refunds it again.',
  })
  @IsIn(Object.values(RefundClaimOutcomes))
  outcome!: RefundClaimOutcome;

  @ApiPropertyOptional({
    description: "bKash's refund trxID from the merchant portal. Only with `refunded`.",
    maxLength: PaymentConstants.MaxRefundTransactionIdLength,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PaymentConstants.MaxRefundTransactionIdLength)
  refundTransactionId?: string;
}

export class RefundClaimResolutionDto {
  @ApiProperty() claimId!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: Object.values(RefundClaimOutcomes) }) outcome!: RefundClaimOutcome;
  @ApiProperty({ description: "Whether this resolution marked the order's payment REFUNDED." })
  orderRefunded!: boolean;
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
  @ApiPropertyOptional({
    nullable: true,
    description:
      "bKash's trxID: the payment's on a CHARGE, bKash's refund trxID on a REFUND. What staff " +
      'search the bKash merchant portal by.',
  })
  gatewayTransactionId!: string | null;
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

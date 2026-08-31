import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { OrderStatus, PaymentMethod, PaymentStatus } from '../../../infra/prisma/prisma-client';
import { OrderConstants } from '../order.constants';

export class PlaceOrderDto {
  @ApiProperty({ format: 'uuid', description: "One of the caller's saved addresses" })
  @IsString()
  @IsNotEmpty()
  addressId!: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH_ON_DELIVERY })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Promo code to apply. Validated and priced server-side.' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(32)
  promotionCode?: string | null;

  @ApiPropertyOptional({ maxLength: OrderConstants.MaxCustomerNoteLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(OrderConstants.MaxCustomerNoteLength)
  customerNote?: string | null;

  /**
   * Set when the customer has seen and accepted a price change.
   *
   * Without it a basket whose prices moved is refused rather than silently charged at the new
   * price — which is the whole reason the added price is stored.
   */
  @ApiPropertyOptional({
    default: false,
    description: 'Confirms the customer has accepted any price changes shown in the basket',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  acceptPriceChanges?: boolean;
}

export class OrderItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productNameEn!: string;
  @ApiProperty() productNameBn!: string;
  @ApiProperty() variantNameEn!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: 'Frozen at placement, in poysha' }) unitPricePoysha!: number;
  @ApiProperty() lineTotalPoysha!: number;
  @ApiProperty({ example: '৳2,500.00' }) lineTotalFormatted!: string;
}

export class OrderEventDto {
  @ApiPropertyOptional({ enum: OrderStatus, nullable: true }) fromStatus!: OrderStatus | null;
  @ApiProperty({ enum: OrderStatus }) toStatus!: OrderStatus;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class OrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'BB-20260830-000042' }) orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) paymentStatus!: PaymentStatus;
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() division!: string;
  @ApiProperty() district!: string;
  @ApiProperty() unit!: string;
  @ApiPropertyOptional({ nullable: true }) area!: string | null;
  @ApiProperty() addressLine!: string;
  @ApiPropertyOptional({ nullable: true }) postCode!: string | null;
  @ApiProperty() subtotalPoysha!: number;
  @ApiProperty() deliveryFeePoysha!: number;
  @ApiProperty() discountPoysha!: number;
  @ApiProperty() totalPoysha!: number;
  @ApiProperty({ example: '৳2,540.00' }) totalFormatted!: string;
  @ApiPropertyOptional({ nullable: true }) customerNote!: string | null;
  @ApiProperty() placedAt!: Date;
  @ApiPropertyOptional({ nullable: true }) deliveredAt!: Date | null;
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiPropertyOptional({ type: [OrderEventDto], description: 'Present on the detail view' })
  events?: OrderEventDto[];
  @ApiProperty({ description: 'True while the customer may still cancel it themselves' })
  canCancel!: boolean;
}

export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class AdminOrderQueryDto extends OrderQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  warehouseId?: string;
}

/** Moving an order along. The transition itself is validated against ORDER_TRANSITIONS. */
export class TransitionOrderDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ maxLength: OrderConstants.MaxStaffNoteLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(OrderConstants.MaxStaffNoteLength)
  note?: string | null;
}

export class CancelOrderDto {
  @ApiPropertyOptional({ maxLength: OrderConstants.MaxCustomerNoteLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(OrderConstants.MaxCustomerNoteLength)
  reason?: string | null;
}

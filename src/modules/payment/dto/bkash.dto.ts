import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '../../../infra/prisma/prisma-client';

/** Where to send the customer to pay, and how long the attempt stays open. */
export class BkashCheckoutStartedDto {
  @ApiProperty({ description: "bKash's hosted payment page. Send the customer's browser here." })
  redirectUrl!: string;

  @ApiProperty({ description: 'Seconds the customer has to finish paying on bKash.' })
  expiresInSeconds!: number;
}

/**
 * The payment methods checkout may offer right now. Cash on delivery is always there; bKash only
 * when a real gateway is configured, since the noop gateway refuses every bKash start.
 */
export class PaymentMethodsDto {
  @ApiProperty({ enum: PaymentMethod, isArray: true, example: ['CASH_ON_DELIVERY', 'BKASH'] })
  methods!: PaymentMethod[];
}

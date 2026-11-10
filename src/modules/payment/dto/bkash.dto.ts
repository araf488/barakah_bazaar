import { ApiProperty } from '@nestjs/swagger';

/** Where to send the customer to pay, and how long the attempt stays open. */
export class BkashCheckoutStartedDto {
  @ApiProperty({ description: "bKash's hosted payment page. Send the customer's browser here." })
  redirectUrl!: string;

  @ApiProperty({ description: 'Seconds the customer has to finish paying on bKash.' })
  expiresInSeconds!: number;
}

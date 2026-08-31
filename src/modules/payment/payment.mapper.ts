import { Money } from '../../common/money/money';
import { PaymentTransaction } from '../../infra/prisma/prisma-client';
import { OrderPaymentSummaryDto, PaymentTransactionDto } from './dto/payment.dto';

/**
 * Wire format for the ledger.
 *
 * `collectedBy` is withheld: which staff member took the cash is an internal accountability
 * record, and the customer-facing summary uses this same mapper.
 */
export const PaymentMapper = {
  toDto(row: PaymentTransaction): PaymentTransactionDto {
    return {
      id: row.id,
      orderId: row.orderId,
      method: row.method,
      direction: row.direction,
      status: row.status,
      amountPoysha: Money.toJsonNumber(row.amountPoysha),
      gatewayReference: row.gatewayReference,
      failureReason: row.failureReason,
      capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  },

  toSummary(
    orderId: string,
    totalPoysha: bigint,
    capturedPoysha: bigint,
    refundedPoysha: bigint,
    transactions: PaymentTransaction[],
  ): OrderPaymentSummaryDto {
    return {
      orderId,
      totalPoysha: Money.toJsonNumber(totalPoysha),
      capturedPoysha: Money.toJsonNumber(capturedPoysha),
      refundedPoysha: Money.toJsonNumber(refundedPoysha),
      outstandingPoysha: Money.toJsonNumber(totalPoysha - capturedPoysha + refundedPoysha),
      transactions: transactions.map((row) => PaymentMapper.toDto(row)),
    };
  },
} as const;

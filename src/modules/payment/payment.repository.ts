import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  Prisma,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PaymentConstants } from './payment.constants';

export interface RecordPaymentData {
  orderId: string;
  method: PaymentMethod;
  direction: PaymentDirection;
  status: PaymentTransactionStatus;
  amountPoysha: bigint;
  gatewayReference: string | null;
  collectedBy: string | null;
  failureReason: string | null;
}

export interface PaymentPage {
  items: PaymentTransaction[];
  total: number;
}

/** What an order has actually taken and given back. */
export interface PaymentTotals {
  capturedPoysha: bigint;
  refundedPoysha: bigint;
}

@Injectable()
export class PaymentRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PaymentRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Writes the money movement **and** the order's summary status in one transaction.
   *
   * These cannot be two writes. An order marked PAID with no transaction row is money nobody
   * can trace; a captured row against an order still PENDING sends the customer a second
   * demand for cash they already handed over. Either both land or neither does.
   */
  async settle(
    data: RecordPaymentData,
    orderStatus: PaymentStatus | null,
  ): Promise<PaymentTransaction | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.paymentTransaction.create({
          data: {
            ...data,
            failureReason: PaymentRepository.trim(data.failureReason),
            capturedAt: data.status === PaymentTransactionStatus.CAPTURED ? new Date() : null,
          },
        });

        if (orderStatus) {
          await tx.order.update({
            where: { id: data.orderId },
            data: { paymentStatus: orderStatus },
          });
        }

        return payment;
      });
    } catch (error) {
      // A duplicate gateway reference lands here: the unique index is what makes a replayed
      // webhook harmless, so this is an expected outcome rather than a surprise.
      this.logger.error(
        { err: error, orderId: data.orderId, direction: data.direction },
        'Exception occurred in PaymentRepository.settle',
      );
      return null;
    }
  }

  /** An existing row for this gateway reference, if the webhook has already been seen. */
  async findByReference(reference: string): Promise<PaymentTransaction | null | undefined> {
    try {
      return (
        (await this.prisma.paymentTransaction.findUnique({
          where: { gatewayReference: reference },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PaymentRepository.findByReference');
      return null;
    }
  }

  /**
   * Sums what an order has captured and refunded.
   *
   * Computed from the ledger rather than kept on the order, so the two can never disagree.
   */
  async totalsForOrder(orderId: string): Promise<PaymentTotals | null> {
    try {
      const rows = await this.prisma.paymentTransaction.groupBy({
        by: ['direction'],
        where: { orderId, status: PaymentTransactionStatus.CAPTURED },
        _sum: { amountPoysha: true },
      });

      const sumOf = (direction: PaymentDirection): bigint =>
        rows.find((row) => row.direction === direction)?._sum.amountPoysha ?? 0n;

      return {
        capturedPoysha: sumOf(PaymentDirection.CHARGE),
        refundedPoysha: sumOf(PaymentDirection.REFUND),
      };
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentRepository.totalsForOrder',
      );
      return null;
    }
  }

  /** The ledger for one order, oldest first: a payment history reads forwards. */
  async findForOrder(orderId: string): Promise<PaymentTransaction[] | null> {
    try {
      return await this.prisma.paymentTransaction.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in PaymentRepository.findForOrder',
      );
      return null;
    }
  }

  /** The whole ledger for staff, newest first. */
  async findPage(
    where: Prisma.PaymentTransactionWhereInput,
    skip: number,
    take: number,
  ): Promise<PaymentPage | null> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.paymentTransaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.paymentTransaction.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PaymentRepository.findPage');
      return null;
    }
  }

  /** Keeps a gateway response body out of the column. */
  private static trim(reason: string | null): string | null {
    return reason ? reason.slice(0, PaymentConstants.MaxFailureLength) : null;
  }
}

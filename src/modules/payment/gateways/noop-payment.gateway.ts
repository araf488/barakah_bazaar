import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  GatewayChargeRequest,
  GatewayRefundRequest,
  GatewayResult,
  PaymentGateway,
} from '../ports/payment-gateway.port';

/**
 * The default adapter while no gateway is contracted.
 *
 * It **refuses** rather than pretending to succeed. A noop SMS gateway can safely report
 * success — the cost of a silently undelivered message is small and the retry sweep sees it.
 * A payment gateway that reported success would mark orders paid that nobody paid for, which
 * is a hole in the books rather than a missing message. Failing closed is the only safe
 * default for money.
 *
 * Active while `PAYMENT_PROVIDER=noop`, which is the default so a fresh clone boots with no
 * merchant account. Cash on delivery is unaffected: it never goes through a gateway.
 */
@Injectable()
export class NoopPaymentGateway implements PaymentGateway {
  constructor(@InjectPinoLogger(NoopPaymentGateway.name) private readonly logger: PinoLogger) {}

  charge(request: GatewayChargeRequest): Promise<GatewayResult> {
    return Promise.resolve(this.refuse('charge', request.orderNumber));
  }

  refund(request: GatewayRefundRequest): Promise<GatewayResult> {
    return Promise.resolve(this.refuse('refund', request.originalReference));
  }

  private refuse(operation: string, subject: string): GatewayResult {
    // The amount is deliberately not logged: it is not needed to diagnose a disabled gateway.
    this.logger.warn(
      { operation, subject },
      'Payment gateway is not configured; refusing rather than reporting success',
    );

    return {
      ok: false,
      reference: null,
      pending: false,
      failureReason: 'No payment gateway is configured.',
    };
  }
}

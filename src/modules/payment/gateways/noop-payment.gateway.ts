import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  CheckoutOutcome,
  GatewayChargeRequest,
  GatewayCheckoutRequest,
  GatewayCheckoutResult,
  GatewayRefundRequest,
  GatewayRefundResult,
  GatewayResult,
  PaymentGateway,
} from '../ports/payment-gateway.port';

/** Failure text for every refusal, in the ledger and in a `CheckoutOutcome`. */
const NOOP_FAILURE_REASON = 'No payment gateway is configured.';

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

  /** Refused before anything is sent, so the refusal is definitive. */
  refund(request: GatewayRefundRequest): Promise<GatewayRefundResult> {
    return Promise.resolve({
      ...this.refuse('refund', request.originalReference),
      ambiguous: false,
    });
  }

  createCheckout(request: GatewayCheckoutRequest): Promise<GatewayCheckoutResult> {
    this.warnRefused('createCheckout', request.orderNumber);
    return Promise.resolve({ ok: false, failureReason: NOOP_FAILURE_REASON });
  }

  /** `error`, never `completed`, so a noop provider can never settle an attempt as paid. */
  executeCheckout(paymentId: string): Promise<CheckoutOutcome> {
    this.warnRefused('executeCheckout', paymentId);
    return Promise.resolve({ kind: 'error', reason: NOOP_FAILURE_REASON });
  }

  queryCheckout(paymentId: string): Promise<CheckoutOutcome> {
    this.warnRefused('queryCheckout', paymentId);
    return Promise.resolve({ kind: 'error', reason: NOOP_FAILURE_REASON });
  }

  private refuse(operation: string, subject: string): GatewayResult {
    this.warnRefused(operation, subject);

    return {
      ok: false,
      reference: null,
      pending: false,
      failureReason: NOOP_FAILURE_REASON,
    };
  }

  private warnRefused(operation: string, subject: string): void {
    // The amount is deliberately not logged: it is not needed to diagnose a disabled gateway.
    this.logger.warn(
      { operation, subject },
      'Payment gateway is not configured; refusing rather than reporting success',
    );
  }
}

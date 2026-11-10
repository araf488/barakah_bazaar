import {
  CheckoutOutcome,
  GatewayChargeRequest,
  GatewayCheckoutRequest,
  GatewayCheckoutResult,
  GatewayRefundRequest,
  GatewayRefundResult,
  GatewayResult,
  PaymentGateway,
} from '../../src/modules/payment/ports/payment-gateway.port';

/** The currency bKash reports on a completed payment. */
export const BKASH_CURRENCY = 'BDT';

/** What a checkout the fake never heard of reads as: bKash has not decided. */
const UNSCRIPTED_QUERY: CheckoutOutcome = { kind: 'pending' };

/** What an execute the test did not script reads as: a fault, which decides nothing. */
const UNSCRIPTED_EXECUTE: CheckoutOutcome = { kind: 'error', reason: 'execute was not scripted' };

/** The refund answer unless a test scripts another. */
const refundAccepted = (reference: string): GatewayRefundResult => ({
  ok: true,
  reference,
  pending: false,
  failureReason: null,
  ambiguous: false,
});

/** A refusal bKash states outright, so the claim is released and the refund can be retried. */
export const refundRefused = (failureReason: string): GatewayRefundResult => ({
  ok: false,
  reference: null,
  pending: false,
  failureReason,
  ambiguous: false,
});

/** What bKash answers once a payment really completed. */
export const completedOutcome = (
  transactionId: string,
  amountPoysha: bigint,
  orderNumber: string,
  currency: string = BKASH_CURRENCY,
): CheckoutOutcome => ({ kind: 'completed', transactionId, amountPoysha, currency, orderNumber });

/**
 * A scriptable stand-in for the bKash adapter, bound with
 * `overrideProvider(PaymentTokens.PaymentGateway)`. No network, no credentials.
 *
 * Every call is recorded, so a test can say what bKash was and was not asked. Answers are set
 * per `paymentID`: an unscripted execute reads as a fault and an unscripted query as `pending`,
 * so a settlement can never happen by accident.
 */
export class FakeBkashGateway implements PaymentGateway {
  readonly createCalls: GatewayCheckoutRequest[] = [];
  readonly executeCalls: string[] = [];
  readonly queryCalls: string[] = [];
  readonly refundCalls: GatewayRefundRequest[] = [];

  private readonly executeAnswers = new Map<string, CheckoutOutcome>();
  private readonly queryAnswers = new Map<string, CheckoutOutcome>();
  private readonly refundAnswers: GatewayRefundResult[] = [];
  private readonly createAnswers: GatewayCheckoutResult[] = [];
  private issued = 0;

  /** Clears every recorded call and every scripted answer. Call between tests. */
  reset(): void {
    this.createCalls.length = 0;
    this.executeCalls.length = 0;
    this.queryCalls.length = 0;
    this.refundCalls.length = 0;
    this.executeAnswers.clear();
    this.queryAnswers.clear();
    this.refundAnswers.length = 0;
    this.createAnswers.length = 0;
    this.issued = 0;
  }

  /** The next `createCheckout` answers this, once. Later ones issue a fresh `PAYID-n`. */
  nextCreate(result: GatewayCheckoutResult): void {
    this.createAnswers.push(result);
  }

  /** What `executeCheckout` answers for this payment, every time it is asked. */
  scriptExecute(paymentId: string, outcome: CheckoutOutcome): void {
    this.executeAnswers.set(paymentId, outcome);
  }

  /** What `queryCheckout` answers for this payment, every time it is asked. */
  scriptQuery(paymentId: string, outcome: CheckoutOutcome): void {
    this.queryAnswers.set(paymentId, outcome);
  }

  /** The next `refund` answers this, once. Later ones are accepted with `REFUND-n`. */
  nextRefund(result: GatewayRefundResult): void {
    this.refundAnswers.push(result);
  }

  /** The `paymentID` of the checkout created most recently. Throws when there was none. */
  latestPaymentId(): string {
    if (this.issued === 0) {
      throw new Error('No checkout was created');
    }

    return `PAYID-${this.issued}`;
  }

  createCheckout(request: GatewayCheckoutRequest): Promise<GatewayCheckoutResult> {
    this.createCalls.push(request);
    const scripted = this.createAnswers.shift();

    if (scripted) {
      return Promise.resolve(scripted);
    }

    this.issued += 1;
    const paymentId = `PAYID-${this.issued}`;
    return Promise.resolve({
      ok: true,
      paymentId,
      redirectUrl: `https://pay.bkash.example/checkout/${paymentId}`,
    });
  }

  executeCheckout(paymentId: string): Promise<CheckoutOutcome> {
    this.executeCalls.push(paymentId);
    return Promise.resolve(this.executeAnswers.get(paymentId) ?? UNSCRIPTED_EXECUTE);
  }

  queryCheckout(paymentId: string): Promise<CheckoutOutcome> {
    this.queryCalls.push(paymentId);
    return Promise.resolve(this.queryAnswers.get(paymentId) ?? UNSCRIPTED_QUERY);
  }

  refund(request: GatewayRefundRequest): Promise<GatewayRefundResult> {
    this.refundCalls.push(request);
    return Promise.resolve(
      this.refundAnswers.shift() ?? refundAccepted(`REFUND-${this.refundCalls.length}`),
    );
  }

  /** The card-style charge is not part of bKash Tokenized Checkout; any call is a test bug. */
  charge(_request: GatewayChargeRequest): Promise<GatewayResult> {
    return Promise.reject(new Error('charge is not used by bKash Tokenized Checkout'));
  }
}

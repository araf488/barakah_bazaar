/** One request to move money through an online gateway. */
export interface GatewayChargeRequest {
  /** Always positive, in poysha. */
  readonly amountPoysha: bigint;
  /** The order this pays for, quoted back to the gateway for reconciliation. */
  readonly orderNumber: string;
  /** E.164 payer number, where the gateway needs one. */
  readonly payerPhone: string | null;
}

/** One request to send money back. */
export interface GatewayRefundRequest {
  readonly amountPoysha: bigint;
  /** The gateway reference of the charge being reversed. */
  readonly originalReference: string;
  /**
   * The gateway's transaction id for that charge (bKash's trxID), or null when the charge row
   * never recorded one. bKash names the transaction, not the payment, when it refunds.
   */
  readonly transactionId: string | null;
}

/** One request to start a hosted checkout, where the customer pays on the gateway's own page. */
export interface GatewayCheckoutRequest {
  /** Always positive, in poysha. */
  readonly amountPoysha: bigint;
  /** The order this pays for, quoted back to the gateway for reconciliation. */
  readonly orderNumber: string;
  /** Absolute URL the gateway sends the customer's browser back to. */
  readonly callbackUrl: string;
  /** An opaque id for the payer, for the gateway's own records. Never a phone number. */
  readonly payerReference: string;
}

/** What starting a hosted checkout produced. */
export type GatewayCheckoutResult =
  | { readonly ok: true; readonly paymentId: string; readonly redirectUrl: string }
  | { readonly ok: false; readonly failureReason: string };

/**
 * What a gateway says about a hosted checkout it was asked to execute or look up.
 *
 * `error` is a transport or gateway fault and means "decide nothing": the caller must not
 * settle the attempt either way, because the customer may well have paid.
 */
export type CheckoutOutcome =
  | {
      readonly kind: 'completed';
      readonly transactionId: string;
      readonly amountPoysha: bigint;
      readonly currency: string;
      readonly orderNumber: string;
    }
  | { readonly kind: 'failed' | 'cancelled' | 'expired'; readonly reason: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'error'; readonly reason: string };

/**
 * What a gateway says happened.
 *
 * `reference` is the gateway's own id and is what makes a webhook idempotent, so an adapter
 * must return it on success. `pending` distinguishes "the customer still has to authorise
 * this" from "the money moved", which is the difference between bKash and a card capture.
 */
export interface GatewayResult {
  readonly ok: boolean;
  readonly reference: string | null;
  readonly pending: boolean;
  /** Failure text for the ledger. Never a token, a PIN or a card number. */
  readonly failureReason: string | null;
}

/**
 * What a refund produced.
 *
 * `ambiguous` is true when the request may have reached the gateway but no readable answer says
 * what happened (a transport fault, a timeout, a server error or an unreadable reply): the money
 * may already be on its way back, so the caller must not release the refund for a retry. It is
 * false on success and on a refusal the gateway actually stated, or when nothing was sent.
 */
export interface GatewayRefundResult extends GatewayResult {
  readonly ambiguous: boolean;
}

/**
 * Online payment port.
 *
 * One adapter per gateway behind this interface, so the order and payment services never
 * learn which one ran. Cash on delivery deliberately does **not** implement it: cash is
 * settled by a staff member at the doorstep, and modelling that as a gateway call would
 * invent a network round trip that does not exist.
 */
export interface PaymentGateway {
  charge(request: GatewayChargeRequest): Promise<GatewayResult>;
  refund(request: GatewayRefundRequest): Promise<GatewayRefundResult>;
  /** Starts a hosted checkout. Never throws: a fault is `{ ok: false }`. */
  createCheckout(request: GatewayCheckoutRequest): Promise<GatewayCheckoutResult>;
  /** Asks the gateway to capture a checkout the customer has authorised. */
  executeCheckout(paymentId: string): Promise<CheckoutOutcome>;
  /** Reads where a checkout stands, without changing it. */
  queryCheckout(paymentId: string): Promise<CheckoutOutcome>;
}

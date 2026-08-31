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
}

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
 * Online payment port.
 *
 * One adapter per gateway behind this interface, so the order and payment services never
 * learn which one ran. Cash on delivery deliberately does **not** implement it: cash is
 * settled by a staff member at the doorstep, and modelling that as a gateway call would
 * invent a network round trip that does not exist.
 */
export interface PaymentGateway {
  charge(request: GatewayChargeRequest): Promise<GatewayResult>;
  refund(request: GatewayRefundRequest): Promise<GatewayResult>;
}

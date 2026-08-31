/** DI tokens for the ports this module resolves at runtime. */
export const PaymentTokens = {
  /** The online gateway. Cash is not a gateway and never goes through it. */
  PaymentGateway: 'PAYMENT_GATEWAY',
} as const;

export const PaymentConstants = {
  RouteBase: 'payments',
  AdminRouteBase: 'admin/payments',
  DefaultPageSize: 20,
  MaxPageSize: 100,
  /** Longest gateway failure text kept, so a response body cannot land in the column. */
  MaxFailureLength: 500,
} as const;

export const PaymentMessages = {
  /** The order named does not exist, or the caller may not see it. */
  OrderNotFound: 'Order not found.',
  /** Cash was recorded against an order that is not collecting cash. */
  NotCashOnDelivery: 'This order is not paid by cash on delivery.',
  /** Cash was recorded before the order reached the customer. */
  NotDeliverable: 'Cash can only be collected on an order that is out for delivery or delivered.',
  /** A second capture on an order that is already settled. */
  AlreadyPaid: 'This order has already been paid.',
  /** A refund was asked for on an order that never took any money. */
  NothingToRefund: 'This order has no captured payment to refund.',
  /** The refund asked for is larger than what is left. */
  RefundExceedsCaptured: 'A refund cannot exceed the amount captured.',
  /** The amount offered does not match what the order says it costs. */
  AmountMismatch: 'The amount does not match the order total.',
  /** The database could not be read or written. */
  Unavailable: 'Could not process the payment. Please try again.',
  /** No adapter is configured for the order's payment method. */
  MethodUnsupported: 'This payment method is not available yet.',
} as const;

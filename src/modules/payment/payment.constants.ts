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
  /** How long a bKash attempt may stay open before the customer must start a new one. */
  BkashAttemptWindowMinutes: 15,
  /** Unit conversions for the attempt window. */
  SecondsPerMinute: 60,
  MillisecondsPerSecond: 1_000,
  /** `PAYMENT_PROVIDER` value under which no online gateway is configured. */
  NoopProvider: 'noop',
  /** How often the reconciliation sweep runs. */
  ReconcileIntervalMinutes: 5,
  /** An attempt must be this old before the sweep asks bKash about it. */
  ReconcileAfterMinutes: 2,
  /** Most attempts one sweep looks at. */
  ReconcileBatchSize: 50,
  /** An attempt bKash never settled is abandoned after this long. */
  AbandonAfterHours: 24,
  /** Unit conversion for the abandonment window. */
  MinutesPerHour: 60,
  /**
   * A refund that failed is left out of the sweep's batch for this long, so charges bKash keeps
   * refusing cannot fill the oldest-first batch and starve the ones behind them.
   */
  RefundRetryCooldownMinutes: 30,
  /**
   * An attempt bKash left undecided (still pending, or unreadable) is left out of the sweep's
   * batch for this long, so a pile of abandoned checkouts cannot fill the oldest-first batch and
   * starve the attempts behind them. Kept short, and above the sweep interval so it skips a tick:
   * a customer who pays after the first look must still be found while the hold is open.
   */
  ReconcileRetryCooldownMinutes: 10,
  /** Longest a call to bKash may take before it is abandoned. */
  BkashRequestTimeoutMs: 15_000,
  /** A cached bKash token is refreshed this many seconds before it expires. */
  BkashTokenRefreshMarginSeconds: 300,
  /** Path, under the API prefix, that bKash sends the customer's browser back to. */
  CallbackPath: 'api/v1/payments/bkash/callback',
  /**
   * Route, under the admin base, where a SUPER_ADMIN settles a stuck automatic refund claim.
   * `:id` is the claim's ledger row.
   */
  RefundClaimResolveRoute: 'refund-claims/:id/resolve',
  /** Longest bKash refund trxID a person may record against a claim; bKash's are far shorter. */
  MaxRefundTransactionIdLength: 64,
  /** Storefront path the callback redirects the customer to with the outcome. */
  ResultPath: 'checkout/payment-result',
  /** Route, under the API prefix, that starts a bKash payment. `:id` is the order. */
  BkashStartRoute: 'orders/:id/payments/bkash',
  /** Route, under the API prefix, bKash sends the customer's browser back to. */
  BkashCallbackRoute: 'payments/bkash/callback',
  /** Longest `paymentID` the callback accepts; bKash's are far shorter. */
  MaxCallbackPaymentIdLength: 64,
  /** The only callback `status` that makes the callback ask bKash to execute the payment. */
  CallbackSuccessStatus: 'success',
  /** Storefront redirect query parameter naming the order. */
  ResultOrderParam: 'order',
  /** Storefront redirect query parameter naming how the payment ended. */
  ResultOutcomeParam: 'outcome',
  /** Order event note when a bKash payment is captured. */
  PaidByBkashNote: 'Paid by bKash.',
  /** Failure reason on an attempt the sweep gave up on. */
  AbandonedAttemptReason: 'bKash never completed this payment.',
  /** Failure reason on an attempt bKash completed for a different amount or order. */
  AmountMismatchReason: 'bKash completed a different amount or order.',
  /**
   * Prefix of an automatic refund row's `gateway_reference`, followed by the charge's trxID.
   * It ties each refund to its charge, and the unique index makes a second refund row for the
   * same charge impossible.
   */
  AutoRefundReferencePrefix: 'refund:',
} as const;

/**
 * What a person found in the bKash merchant portal for a stuck refund claim: bKash refunded it,
 * or it did not (ruling R18).
 */
export const RefundClaimOutcomes = {
  Refunded: 'refunded',
  NotRefunded: 'not-refunded',
} as const;

export type RefundClaimOutcome = (typeof RefundClaimOutcomes)[keyof typeof RefundClaimOutcomes];

/** The outcome word the callback puts in the storefront redirect. */
export const BkashOutcome = {
  Paid: 'paid',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Pending: 'pending',
} as const;

/** One of the words the callback puts in the storefront redirect. */
export type BkashOutcomeWord = (typeof BkashOutcome)[keyof typeof BkashOutcome];

/**
 * How settling a bKash outcome ended. The first four are the redirect words; `refunded` means
 * the money was captured but the order could not keep it, so the customer is told `failed`.
 */
export const SettleResults = {
  ...BkashOutcome,
  Refunded: 'refunded',
} as const;

export type SettleResult = (typeof SettleResults)[keyof typeof SettleResults];

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
  /** A bKash payment was started on an order that is not paid by bKash. */
  NotBkashOrder: 'This order is not paid by bKash.',
  /** A bKash payment was started on an order that is cancelled or already settled. */
  OrderNotPayable: 'This order can no longer be paid.',
  /** A bKash payment was started after the order's payment window ended. */
  PaymentWindowClosed: 'The time to pay for this order has passed.',
  /** bKash is not the configured gateway, so it cannot be offered. */
  BkashUnavailable: 'bKash payment is not available right now.',
  /** bKash refused or failed to create the payment. */
  GatewayUnavailable: 'bKash could not start the payment. Please try again.',
  /** Returned (404) for a resolve on an id that is not an automatic bKash refund claim. */
  RefundClaimNotFound: 'Refund claim not found.',
  /** Returned (409) for a resolve on a claim that is no longer PENDING. */
  RefundClaimAlreadyResolved: 'This refund claim has already been resolved.',
  /** Returned (409) when the refund trxID given is already recorded on another ledger row. */
  RefundTransactionIdRecorded: 'That bKash refund transaction ID is already recorded.',
  /** Returned (400) for a refund trxID on a claim resolved as not refunded. */
  RefundTransactionIdNotApplicable:
    'A refund transaction ID can only be given when the refund was made.',
} as const;

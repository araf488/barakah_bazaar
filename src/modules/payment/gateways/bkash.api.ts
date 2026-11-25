/**
 * bKash Tokenized Checkout wire contract (v1.2.0-beta).
 *
 * UNVERIFIED against bKash's official documentation: developer.bka.sh could not be reached
 * while this was written (Cloudflare challenge), so every path, header, field and status word
 * below follows the widely published v1.2.0-beta shapes. A sandbox run is a mandatory gate
 * before `PAYMENT_PROVIDER=bkash` is enabled, and a wrong name is corrected here and nowhere else.
 */
export const BkashApi = {
  /** Appended to `PAYMENT_API_URL`, which already carries the version, e.g. `.../v1.2.0-beta`. */
  Paths: {
    Grant: '/tokenized/checkout/token/grant',
    Refresh: '/tokenized/checkout/token/refresh',
    Create: '/tokenized/checkout/create',
    Execute: '/tokenized/checkout/execute',
    Query: '/tokenized/checkout/payment/status',
    Refund: '/tokenized/checkout/payment/refund',
  },
  Headers: {
    Username: 'username',
    Password: 'password',
    Authorization: 'Authorization',
    AppKey: 'X-APP-Key',
    ContentType: 'Content-Type',
    Accept: 'Accept',
  },
  JsonMediaType: 'application/json',
  Fields: {
    AppKey: 'app_key',
    AppSecret: 'app_secret',
    RefreshToken: 'refresh_token',
    IdToken: 'id_token',
    ExpiresIn: 'expires_in',
    Mode: 'mode',
    PayerReference: 'payerReference',
    CallbackUrl: 'callbackURL',
    Amount: 'amount',
    Currency: 'currency',
    Intent: 'intent',
    MerchantInvoiceNumber: 'merchantInvoiceNumber',
    PaymentId: 'paymentID',
    BkashUrl: 'bkashURL',
    TransactionId: 'trxID',
    TransactionStatus: 'transactionStatus',
    StatusCode: 'statusCode',
    StatusMessage: 'statusMessage',
    ErrorCode: 'errorCode',
    Sku: 'sku',
    Reason: 'reason',
    RefundTransactionId: 'refundTrxID',
  },
  /** `statusCode` that means the call itself succeeded. */
  SuccessStatusCode: '0000',
  /** `transactionStatus` values that settle a payment or a refund. */
  Status: {
    Completed: 'Completed',
    Cancelled: 'Cancelled',
    Failed: 'Failed',
    Expired: 'Expired',
  },
  Mode: '0011',
  Intent: 'sale',
  Currency: 'BDT',
  /** Refund `sku` and `reason`; bKash accepts at most 255 characters for each. */
  RefundSku: 'order',
  RefundReason: 'Order could not accept the payment',
  /** HTTP status bKash answers when the token is invalid or expired. */
  InvalidTokenHttpStatus: 401,
  /** A `statusCode` starting with this and a message matching the pattern also mean a bad token. */
  InvalidTokenCodePrefix: '2',
  InvalidTokenMessagePattern: /token/i,
  /** Success range of an HTTP status. */
  HttpOkMin: 200,
  HttpOkMax: 299,
  /** From here up the server failed mid-request, so a refund it was handling may have gone through. */
  HttpServerErrorMin: 500,
  /** A 4xx means bKash refused the request itself. */
  HttpClientErrorMin: 400,
  /**
   * Refund `transactionStatus` values that positively say the refund did not happen. Any other
   * value bKash sends without an error code leaves the outcome unknown.
   */
  RefundRefusalStatuses: ['Failed'] as readonly string[],
  MillisPerSecond: 1000,
  /** Longest remote code kept in a failure reason or a log line. */
  MaxLoggedCodeLength: 16,
  /** Remote codes are reduced to these characters before they reach a log or the ledger. */
  UnsafeCodeCharacters: /[^A-Za-z0-9]/g,
} as const;

/** Failure text handed back to callers and the ledger. Never carries a token or a remote body. */
export const BkashFailure = {
  Unreachable: 'bKash could not be reached.',
  UnreadableAnswer: 'bKash sent an unreadable answer.',
  /** `{0}` is the remote status code with everything but letters and digits removed. */
  RejectedTemplate: 'bKash answered status code {0}.',
  /** `{0}` is one of the `BkashApi.Status` words. */
  StatusTemplate: 'bKash reported the payment as {0}.',
  IncompleteCompletion: 'bKash completed the payment without usable details.',
  MissingTransactionId: 'There is no bKash transaction id to refund.',
} as const;

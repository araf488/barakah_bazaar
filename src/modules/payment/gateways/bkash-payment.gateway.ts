import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { Money } from '../../../common/money/money';
import { PaymentConstants, PaymentMessages } from '../payment.constants';
import { stripTrailingSlashes } from '../payment-url';
import {
  CheckoutOutcome,
  GatewayCheckoutRequest,
  GatewayCheckoutResult,
  GatewayRefundRequest,
  GatewayRefundResult,
  GatewayResult,
  PaymentGateway,
} from '../ports/payment-gateway.port';
import { BkashApi, BkashFailure } from './bkash.api';

type BkashBody = Record<string, unknown>;

/** What bKash answered. `body` is null when the answer was not a JSON object. */
interface BkashReply {
  readonly httpStatus: number;
  readonly body: BkashBody | null;
}

interface BkashToken {
  readonly idToken: string;
  readonly refreshToken: string | null;
  readonly expiresAtMs: number;
}

interface BkashCredentials {
  readonly baseUrl: string;
  readonly appKey: string;
  readonly appSecret: string;
  readonly username: string;
  readonly password: string;
}

const isRecord = (value: unknown): value is BkashBody =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A non-empty string field, or null. Anything else (number, object, blank) is treated as absent. */
const textOf = (body: BkashBody, field: string): string | null => {
  const value = body[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
};

/** Reduces a remote code to letters and digits so only a short, inert token reaches a log or the ledger. */
const safeCode = (value: unknown): string => {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return raw.replace(BkashApi.UnsafeCodeCharacters, '').slice(0, BkashApi.MaxLoggedCodeLength);
};

const fill = (template: string, value: string): string => template.replace('{0}', () => value);

const isHttpOk = (reply: BkashReply): boolean =>
  reply.httpStatus >= BkashApi.HttpOkMin && reply.httpStatus <= BkashApi.HttpOkMax;

/** The body of a reply bKash accepted: HTTP 2xx, no errorCode, and `statusCode` '0000'. */
const successBody = (reply: BkashReply | null): BkashBody | null => {
  if (!reply?.body || !isHttpOk(reply) || BkashApi.Fields.ErrorCode in reply.body) {
    return null;
  }
  return reply.body[BkashApi.Fields.StatusCode] === BkashApi.SuccessStatusCode ? reply.body : null;
};

/** Why a reply was not accepted, as text safe for the ledger. */
const rejectionReason = (reply: BkashReply | null): string => {
  if (!reply) {
    return BkashFailure.Unreachable;
  }
  if (!reply.body) {
    return BkashFailure.UnreadableAnswer;
  }
  const code =
    reply.body[BkashApi.Fields.StatusCode] ??
    reply.body[BkashApi.Fields.ErrorCode] ??
    reply.httpStatus;
  return fill(BkashFailure.RejectedTemplate, safeCode(code));
};

/** bKash answers 401, or a 2xxx code whose message names the token, when the token is no good. */
const isInvalidToken = (reply: BkashReply): boolean => {
  if (reply.httpStatus === BkashApi.InvalidTokenHttpStatus) {
    return true;
  }
  const code = reply.body?.[BkashApi.Fields.StatusCode];
  const message = reply.body?.[BkashApi.Fields.StatusMessage];
  return (
    typeof code === 'string' &&
    code.startsWith(BkashApi.InvalidTokenCodePrefix) &&
    typeof message === 'string' &&
    BkashApi.InvalidTokenMessagePattern.test(message)
  );
};

const completedOutcome = (body: BkashBody): CheckoutOutcome => {
  const transactionId = textOf(body, BkashApi.Fields.TransactionId);
  const amountText = textOf(body, BkashApi.Fields.Amount);
  const currency = textOf(body, BkashApi.Fields.Currency);
  const orderNumber = textOf(body, BkashApi.Fields.MerchantInvoiceNumber);
  const amountPoysha = amountText === null ? null : Money.fromDecimalString(amountText);

  if (!transactionId || !currency || !orderNumber || amountPoysha === null || amountPoysha <= 0n) {
    return { kind: 'error', reason: BkashFailure.IncompleteCompletion };
  }
  return { kind: 'completed', transactionId, amountPoysha, currency, orderNumber };
};

/**
 * Maps a execute or query answer to an outcome, failing safe: only a fully described
 * `Completed` answer is `completed`, and anything undecided or broken is `pending` or `error`.
 */
const toOutcome = (reply: BkashReply | null): CheckoutOutcome => {
  const body = successBody(reply);
  if (!body) {
    return { kind: 'error', reason: rejectionReason(reply) };
  }
  const status = textOf(body, BkashApi.Fields.TransactionStatus);
  switch (status) {
    case null:
      return { kind: 'error', reason: BkashFailure.UnreadableAnswer };
    case BkashApi.Status.Completed:
      return completedOutcome(body);
    case BkashApi.Status.Cancelled:
      return { kind: 'cancelled', reason: fill(BkashFailure.StatusTemplate, status) };
    case BkashApi.Status.Failed:
      return { kind: 'failed', reason: fill(BkashFailure.StatusTemplate, status) };
    case BkashApi.Status.Expired:
      return { kind: 'expired', reason: fill(BkashFailure.StatusTemplate, status) };
    default:
      return { kind: 'pending' };
  }
};

const failure = (failureReason: string): GatewayResult => ({
  ok: false,
  reference: null,
  pending: false,
  failureReason,
});

/** A refund refusal. `ambiguous` when bKash may have acted on a request whose answer was lost. */
const refundFailure = (failureReason: string, ambiguous: boolean): GatewayRefundResult => ({
  ...failure(failureReason),
  ambiguous,
});

/** A code field bKash actually filled in: a non-blank string or a number. */
const presentCode = (value: unknown): string | null => {
  const code = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return code === '' ? null : code;
};

/**
 * Whether a refund answer positively says the refund did not happen: an `errorCode`, a
 * `statusCode` other than '0000', a 4xx with a readable body, or a known refusal status. Only
 * then may the claim be released. A server error is never positive, whatever its body says.
 */
const isPositiveRefusal = (reply: BkashReply): boolean => {
  const body = reply.body;
  if (!body || reply.httpStatus >= BkashApi.HttpServerErrorMin) {
    return false;
  }
  if (reply.httpStatus >= BkashApi.HttpClientErrorMin) {
    return true;
  }
  const statusCode = presentCode(body[BkashApi.Fields.StatusCode]);
  if (
    presentCode(body[BkashApi.Fields.ErrorCode]) ||
    (statusCode && statusCode !== BkashApi.SuccessStatusCode)
  ) {
    return true;
  }
  const status = textOf(body, BkashApi.Fields.TransactionStatus);
  return status !== null && BkashApi.RefundRefusalStatuses.includes(status);
};

/** A sent request and what came back. `reply` is null when the answer was lost in transit. */
interface SentRequest {
  readonly token: BkashToken;
  readonly reply: BkashReply | null;
}

/**
 * bKash Tokenized Checkout adapter, selected by `PAYMENT_PROVIDER=bkash`.
 *
 * Paths, headers and field names live in `BkashApi` and are UNVERIFIED against bKash's own
 * documentation; a sandbox run is a mandatory gate before this adapter is enabled.
 *
 * Never throws: every fault becomes `{ ok: false }` or `{ kind: 'error' }`. An `error` outcome
 * means "decide nothing", because the customer may well have paid. Logs carry the operation
 * and coerced status codes only: never a token, credential, header, remote body or phone number,
 * and a thrown error is logged by name.
 *
 * The id_token is cached in memory and refreshed shortly before it expires. Concurrent callers
 * share one in-flight grant or refresh.
 */
export class BkashPaymentGateway implements PaymentGateway {
  private token: BkashToken | null = null;
  private inflight: Promise<BkashToken | null> | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {}

  /** bKash only takes money through a hosted checkout, so a one-call charge is refused. */
  charge(): Promise<GatewayResult> {
    return Promise.resolve(failure(PaymentMessages.MethodUnsupported));
  }

  async createCheckout(request: GatewayCheckoutRequest): Promise<GatewayCheckoutResult> {
    try {
      const reply = await this.authorizedPost(BkashApi.Paths.Create, {
        [BkashApi.Fields.Mode]: BkashApi.Mode,
        [BkashApi.Fields.PayerReference]: request.payerReference,
        [BkashApi.Fields.CallbackUrl]: request.callbackUrl,
        [BkashApi.Fields.Amount]: Money.toDecimalString(request.amountPoysha),
        [BkashApi.Fields.Currency]: BkashApi.Currency,
        [BkashApi.Fields.Intent]: BkashApi.Intent,
        [BkashApi.Fields.MerchantInvoiceNumber]: request.orderNumber,
      });
      const body = successBody(reply);
      const paymentId = body && textOf(body, BkashApi.Fields.PaymentId);
      const redirectUrl = body && textOf(body, BkashApi.Fields.BkashUrl);
      if (!paymentId || !redirectUrl) {
        return { ok: false, failureReason: rejectionReason(reply) };
      }
      return { ok: true, paymentId, redirectUrl };
    } catch (error) {
      this.logFault('createCheckout', error);
      return { ok: false, failureReason: BkashFailure.Unreachable };
    }
  }

  executeCheckout(paymentId: string): Promise<CheckoutOutcome> {
    return this.outcomeOf('executeCheckout', BkashApi.Paths.Execute, paymentId);
  }

  queryCheckout(paymentId: string): Promise<CheckoutOutcome> {
    return this.outcomeOf('queryCheckout', BkashApi.Paths.Query, paymentId);
  }

  /**
   * Refunds by trxID. A refusal is `ambiguous` only when the request left and its answer was lost
   * or unreadable; a stated refusal, or a request that never left, is definitive.
   */
  async refund(request: GatewayRefundRequest): Promise<GatewayRefundResult> {
    try {
      if (!request.transactionId) {
        return refundFailure(BkashFailure.MissingTransactionId, false);
      }
      const sent = await this.authorizedSend(BkashApi.Paths.Refund, {
        [BkashApi.Fields.PaymentId]: request.originalReference,
        [BkashApi.Fields.Amount]: Money.toDecimalString(request.amountPoysha),
        [BkashApi.Fields.TransactionId]: request.transactionId,
        [BkashApi.Fields.Sku]: BkashApi.RefundSku,
        [BkashApi.Fields.Reason]: BkashApi.RefundReason,
      });
      if (!sent) {
        return refundFailure(BkashFailure.Unreachable, false);
      }
      return this.toRefundResult(sent.reply);
    } catch (error) {
      this.logFault('refund', error);
      // Unknown where it failed, so assume the request may have left.
      return refundFailure(BkashFailure.Unreachable, true);
    }
  }

  /**
   * Fail-safe in the other direction from checkout: a refund is `ok` only on a Completed answer,
   * definitive only on a positive refusal, and ambiguous otherwise (a lost answer, a server error,
   * or any 2xx shape that says neither), so a claim is never released on a guess.
   */
  private toRefundResult(reply: BkashReply | null): GatewayRefundResult {
    const body = successBody(reply);
    if (!body || textOf(body, BkashApi.Fields.TransactionStatus) !== BkashApi.Status.Completed) {
      const definitive = reply !== null && isPositiveRefusal(reply);
      return refundFailure(rejectionReason(reply), !definitive);
    }
    const reference = textOf(body, BkashApi.Fields.RefundTransactionId);
    if (!reference) {
      // The money moved, so this is a success: failing it would make the sweeper retry a refund
      // bKash rejects every time. The ledger keeps a null reference.
      this.logger.warn('bKash refund completed without a refund transaction id');
    }
    return { ok: true, reference, pending: false, failureReason: null, ambiguous: false };
  }

  private async outcomeOf(
    operation: string,
    path: string,
    paymentId: string,
  ): Promise<CheckoutOutcome> {
    try {
      const reply = await this.authorizedPost(path, { [BkashApi.Fields.PaymentId]: paymentId });
      return toOutcome(reply);
    } catch (error) {
      this.logFault(operation, error);
      return { kind: 'error', reason: BkashFailure.Unreachable };
    }
  }

  /**
   * Posts with the cached token. An invalid-token answer drops that token, grants a fresh one
   * and retries exactly once; the second answer is returned whatever it says, so a revoked
   * token can never loop.
   */
  private async authorizedPost(path: string, body: BkashBody): Promise<BkashReply | null> {
    const sent = await this.authorizedSend(path, body);
    return sent?.reply ?? null;
  }

  /**
   * {@link authorizedPost}, keeping apart a request that never left (`null`: no credentials or
   * no token) from one whose answer was lost (`reply: null`). A refund needs the difference.
   */
  private async authorizedSend(path: string, body: BkashBody): Promise<SentRequest | null> {
    const first = await this.attempt(path, body);
    if (!first?.reply || !isInvalidToken(first.reply)) {
      return first;
    }
    // Only the token that failed is dropped: a concurrent caller may already have replaced it.
    if (this.token === first.token) {
      this.token = null;
    }
    return await this.attempt(path, body);
  }

  private async attempt(path: string, body: BkashBody): Promise<SentRequest | null> {
    const credentials = this.credentials();
    const token = credentials ? await this.getToken(credentials) : null;
    if (!credentials || !token) {
      return null;
    }
    const reply = await this.send(this.url(credentials, path), body, {
      [BkashApi.Headers.Authorization]: token.idToken,
      [BkashApi.Headers.AppKey]: credentials.appKey,
    });
    return { token, reply };
  }

  private getToken(credentials: BkashCredentials): Promise<BkashToken | null> {
    const cached = this.token;
    if (cached && this.isFresh(cached)) {
      return Promise.resolve(cached);
    }
    this.inflight ??= this.acquireToken(credentials, cached).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private isFresh(token: BkashToken): boolean {
    const marginMs = PaymentConstants.BkashTokenRefreshMarginSeconds * BkashApi.MillisPerSecond;
    return token.expiresAtMs - marginMs > Date.now();
  }

  /** Refreshes a token that is about to expire, and falls back to a full grant when that fails. */
  private async acquireToken(
    credentials: BkashCredentials,
    stale: BkashToken | null,
  ): Promise<BkashToken | null> {
    const refreshed = stale?.refreshToken
      ? await this.requestToken(credentials, BkashApi.Paths.Refresh, {
          [BkashApi.Fields.RefreshToken]: stale.refreshToken,
        })
      : null;
    this.token = refreshed ?? (await this.requestToken(credentials, BkashApi.Paths.Grant, {}));
    return this.token;
  }

  private async requestToken(
    credentials: BkashCredentials,
    path: string,
    extraBody: BkashBody,
  ): Promise<BkashToken | null> {
    const reply = await this.send(
      this.url(credentials, path),
      {
        [BkashApi.Fields.AppKey]: credentials.appKey,
        [BkashApi.Fields.AppSecret]: credentials.appSecret,
        ...extraBody,
      },
      {
        [BkashApi.Headers.Username]: credentials.username,
        [BkashApi.Headers.Password]: credentials.password,
      },
    );
    const body = successBody(reply);
    const idToken = body && textOf(body, BkashApi.Fields.IdToken);
    const expiresInSeconds = Number(body?.[BkashApi.Fields.ExpiresIn]);
    if (!body || !idToken || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      return null;
    }
    return {
      idToken,
      refreshToken: textOf(body, BkashApi.Fields.RefreshToken),
      expiresAtMs: Date.now() + expiresInSeconds * BkashApi.MillisPerSecond,
    };
  }

  /** One POST. `null` means bKash could not be reached; it is already logged. */
  private async send(
    url: string,
    body: BkashBody,
    extraHeaders: Record<string, string>,
  ): Promise<BkashReply | null> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...extraHeaders,
          [BkashApi.Headers.ContentType]: BkashApi.JsonMediaType,
          [BkashApi.Headers.Accept]: BkashApi.JsonMediaType,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PaymentConstants.BkashRequestTimeoutMs),
      });
      const reply = { httpStatus: response.status, body: await this.readBody(response) };
      this.logRejection(reply);
      return reply;
    } catch (error) {
      this.logFault('send', error);
      return null;
    }
  }

  private async readBody(response: Response): Promise<BkashBody | null> {
    try {
      const parsed: unknown = await response.json();
      return isRecord(parsed) ? parsed : null;
    } catch {
      // A 401 or a gateway error page is often not JSON; the HTTP status carries the decision.
      return null;
    }
  }

  private logRejection(reply: BkashReply): void {
    if (successBody(reply)) {
      return;
    }
    // Coerced: both codes come from a remote body, so only short inert text reaches the log.
    this.logger.warn(
      {
        httpStatus: reply.httpStatus,
        statusCode: safeCode(reply.body?.[BkashApi.Fields.StatusCode]),
        errorCode: safeCode(reply.body?.[BkashApi.Fields.ErrorCode]),
      },
      'bKash did not accept a request',
    );
  }

  private logFault(operation: string, error: unknown): void {
    // The error is logged by name only: a fetch error message can echo the request URL or body.
    this.logger.error(
      { operation, errorName: error instanceof Error ? error.name : typeof error },
      'Exception occurred in BkashPaymentGateway',
    );
  }

  private credentials(): BkashCredentials | null {
    const baseUrl = this.config.get('PAYMENT_API_URL', { infer: true });
    const appKey = this.config.get('PAYMENT_APP_KEY', { infer: true });
    const appSecret = this.config.get('PAYMENT_APP_SECRET', { infer: true });
    const username = this.config.get('PAYMENT_USERNAME', { infer: true });
    const password = this.config.get('PAYMENT_PASSWORD', { infer: true });
    if (!baseUrl || !appKey || !appSecret || !username || !password) {
      this.logger.error('bKash is not configured; request not sent');
      return null;
    }
    return { baseUrl, appKey, appSecret, username, password };
  }

  private url(credentials: BkashCredentials, path: string): string {
    return `${stripTrailingSlashes(credentials.baseUrl)}${path}`;
  }
}

import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { PaymentGateway } from '../ports/payment-gateway.port';
import { BkashPaymentGateway } from './bkash-payment.gateway';

const BASE_URL = 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
const APP_KEY = 'app-key-value';
const APP_SECRET = 'app-secret-value';
const USERNAME = 'merchant-user';
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture value, not a credential
const PASSWORD = 'merchant-pass';
const NOW = 1_800_000_000_000;

const GRANT_PATH = '/tokenized/checkout/token/grant';
const REFRESH_PATH = '/tokenized/checkout/token/refresh';
const CREATE_PATH = '/tokenized/checkout/create';
const EXECUTE_PATH = '/tokenized/checkout/execute';
const QUERY_PATH = '/tokenized/checkout/payment/status';
const REFUND_PATH = '/tokenized/checkout/payment/refund';

const checkoutRequest = {
  amountPoysha: 123_450n,
  orderNumber: 'BB-1001',
  callbackUrl: 'https://api.example.com/api/v1/payments/bkash/callback',
  payerReference: 'customer-7',
};

const grantAnswer = (token: string, overrides: Record<string, unknown> = {}) => ({
  statusCode: '0000',
  statusMessage: 'Successful',
  id_token: token,
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: `refresh-of-${token}`,
  ...overrides,
});

const completedAnswer = (overrides: Record<string, unknown> = {}) => ({
  statusCode: '0000',
  statusMessage: 'Successful',
  paymentID: 'PAY-1',
  trxID: 'TRX-9',
  transactionStatus: 'Completed',
  amount: '1234.50',
  currency: 'BDT',
  merchantInvoiceNumber: 'BB-1001',
  payerAccount: '01712345678',
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Answer = () => Response | Promise<Response>;

describe('BkashPaymentGateway', () => {
  let logger: jest.Mocked<PinoLogger>;
  let fetchSpy: jest.SpyInstance;
  let timeoutSpy: jest.SpyInstance;
  let nowSpy: jest.SpyInstance;
  let now: number;
  let answers: Record<string, Answer>;

  const build = (extra: Record<string, unknown> = {}): BkashPaymentGateway =>
    new BkashPaymentGateway(
      createMockConfig({
        PAYMENT_API_URL: BASE_URL,
        PAYMENT_APP_KEY: APP_KEY,
        PAYMENT_APP_SECRET: APP_SECRET,
        PAYMENT_USERNAME: USERNAME,
        PAYMENT_PASSWORD: PASSWORD,
        ...extra,
      }),
      logger,
    );

  /** Every fetch call as `[path, init]`, in order. */
  const sent = (): [string, RequestInit][] =>
    fetchSpy.mock.calls.map(([url, init]: [string, RequestInit]) => [
      url.slice(BASE_URL.length),
      init,
    ]);

  const sentTo = (path: string): RequestInit[] =>
    sent()
      .filter(([sentPath]) => sentPath === path)
      .map(([, init]) => init);

  const bodyOf = (init: RequestInit): Record<string, unknown> =>
    JSON.parse(init.body as string) as Record<string, unknown>;

  const headersOf = (init: RequestInit): Record<string, string> =>
    init.headers as Record<string, string>;

  const answer = (path: string, body: unknown, status = 200): void => {
    answers[path] = () => jsonResponse(body, status);
  };

  beforeEach(() => {
    logger = createMockLogger();
    now = NOW;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    answers = { [GRANT_PATH]: () => jsonResponse(grantAnswer('tok-1')) };
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
      const path = (url as string).slice(BASE_URL.length);
      const respond = answers[path];
      if (!respond) {
        throw new Error(`Unexpected call to ${path}`);
      }
      return Promise.resolve(respond());
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  });

  describe('token grant', () => {
    it('sends username and password as headers and app_key and app_secret as the body', async () => {
      answer(CREATE_PATH, { statusCode: '0000', paymentID: 'P', bkashURL: 'https://pay.bka.sh/x' });

      await build().createCheckout(checkoutRequest);

      const [grant] = sentTo(GRANT_PATH);
      expect(grant.method).toBe('POST');
      expect(headersOf(grant)).toEqual({
        username: USERNAME,
        password: PASSWORD,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
      expect(bodyOf(grant)).toEqual({ app_key: APP_KEY, app_secret: APP_SECRET });
    });

    it('sends the id_token as Authorization and the app key as X-APP-Key on checkout calls', async () => {
      answer(CREATE_PATH, { statusCode: '0000', paymentID: 'P', bkashURL: 'https://pay.bka.sh/x' });

      await build().createCheckout(checkoutRequest);

      const [create] = sentTo(CREATE_PATH);
      expect(headersOf(create)).toEqual({
        Authorization: 'tok-1',
        'X-APP-Key': APP_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    });

    it('joins the path with exactly one slash when the base URL ends in a slash', async () => {
      answer(CREATE_PATH, { statusCode: '0000', paymentID: 'P', bkashURL: 'https://pay.bka.sh/x' });

      await build({ PAYMENT_API_URL: `${BASE_URL}/` }).createCheckout(checkoutRequest);

      expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE_URL}${GRANT_PATH}`);
    });

    it('answers error without calling bKash when a credential is missing', async () => {
      const result = await build({ PAYMENT_PASSWORD: undefined }).executeCheckout('PAY-1');

      expect(result).toEqual({ kind: 'error', reason: 'bKash could not be reached.' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('answers error when the grant is refused', async () => {
      answer(GRANT_PATH, { statusCode: '2001', statusMessage: 'Invalid App Key' });

      const result = await build().queryCheckout('PAY-1');

      expect(result).toEqual({ kind: 'error', reason: 'bKash could not be reached.' });
      expect(sentTo(QUERY_PATH)).toHaveLength(0);
    });

    it('answers error when the grant carries no usable expiry', async () => {
      answer(GRANT_PATH, grantAnswer('tok-1', { expires_in: 'soon' }));

      const result = await build().queryCheckout('PAY-1');

      expect(result.kind).toBe('error');
      expect(sentTo(QUERY_PATH)).toHaveLength(0);
    });
  });

  describe('token cache', () => {
    beforeEach(() => {
      answer(QUERY_PATH, completedAnswer());
    });

    it('grants once for two calls within the token lifetime', async () => {
      const gateway = build();

      await gateway.queryCheckout('PAY-1');
      now += 60_000;
      await gateway.queryCheckout('PAY-1');

      expect(sentTo(GRANT_PATH)).toHaveLength(1);
      expect(sentTo(REFRESH_PATH)).toHaveLength(0);
      expect(sentTo(QUERY_PATH)).toHaveLength(2);
    });

    it('refreshes a token that is within 300 seconds of expiry', async () => {
      answer(REFRESH_PATH, grantAnswer('tok-2'));
      const gateway = build();
      await gateway.queryCheckout('PAY-1');

      now += (3600 - 299) * 1000;
      await gateway.queryCheckout('PAY-1');

      expect(sentTo(GRANT_PATH)).toHaveLength(1);
      const [refresh] = sentTo(REFRESH_PATH);
      expect(headersOf(refresh)).toMatchObject({ username: USERNAME, password: PASSWORD });
      expect(bodyOf(refresh)).toEqual({
        app_key: APP_KEY,
        app_secret: APP_SECRET,
        refresh_token: 'refresh-of-tok-1',
      });
      expect(headersOf(sentTo(QUERY_PATH)[1]).Authorization).toBe('tok-2');
    });

    it('keeps using a token that is just outside the refresh margin', async () => {
      const gateway = build();
      await gateway.queryCheckout('PAY-1');

      now += (3600 - 301) * 1000;
      await gateway.queryCheckout('PAY-1');

      expect(sentTo(GRANT_PATH)).toHaveLength(1);
      expect(sentTo(REFRESH_PATH)).toHaveLength(0);
    });

    it('falls back to a fresh grant when the refresh fails', async () => {
      answer(REFRESH_PATH, { statusCode: '2079', statusMessage: 'Refresh token expired' });
      const gateway = build();
      await gateway.queryCheckout('PAY-1');
      answer(GRANT_PATH, grantAnswer('tok-3'));

      now += 3500 * 1000;
      const result = await gateway.queryCheckout('PAY-1');

      expect(result.kind).toBe('completed');
      expect(sentTo(REFRESH_PATH)).toHaveLength(1);
      expect(sentTo(GRANT_PATH)).toHaveLength(2);
      expect(headersOf(sentTo(QUERY_PATH)[1]).Authorization).toBe('tok-3');
    });

    it('shares one grant between two concurrent first calls (single-flight)', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fetchSpy.mockImplementation(async (url) => {
        const path = (url as string).slice(BASE_URL.length);
        if (path === GRANT_PATH) {
          await gate;
        }
        return answers[path]();
      });
      const gateway = build();

      const both = Promise.all([gateway.queryCheckout('PAY-1'), gateway.queryCheckout('PAY-2')]);
      release();
      const [first, second] = await both;

      expect(first.kind).toBe('completed');
      expect(second.kind).toBe('completed');
      expect(sentTo(GRANT_PATH)).toHaveLength(1);
      expect(sentTo(QUERY_PATH)).toHaveLength(2);
    });
  });

  describe('invalid token mid-request', () => {
    it('re-grants once and retries once on HTTP 401, then succeeds', async () => {
      let queries = 0;
      let grants = 0;
      answers[GRANT_PATH] = () => jsonResponse(grantAnswer(`tok-${++grants}`));
      answers[QUERY_PATH] = () =>
        ++queries === 1 ? jsonResponse({}, 401) : jsonResponse(completedAnswer());

      const result = await build().queryCheckout('PAY-1');

      expect(result.kind).toBe('completed');
      expect(sent().map(([path]) => path)).toEqual([
        GRANT_PATH,
        QUERY_PATH,
        GRANT_PATH,
        QUERY_PATH,
      ]);
      expect(headersOf(sentTo(QUERY_PATH)[1]).Authorization).toBe('tok-2');
    });

    it('gives error after exactly one retry when bKash keeps answering 401', async () => {
      answer(QUERY_PATH, {}, 401);

      const result = await build().queryCheckout('PAY-1');

      expect(result.kind).toBe('error');
      expect(sentTo(GRANT_PATH)).toHaveLength(2);
      expect(sentTo(QUERY_PATH)).toHaveLength(2);
    });

    it('treats a 2xxx status code that names the token as an invalid token', async () => {
      let queries = 0;
      answers[QUERY_PATH] = () =>
        ++queries === 1
          ? jsonResponse({ statusCode: '2079', statusMessage: 'Invalid or expired Token' })
          : jsonResponse(completedAnswer());

      const result = await build().queryCheckout('PAY-1');

      expect(result.kind).toBe('completed');
      expect(sentTo(GRANT_PATH)).toHaveLength(2);
    });

    it('keeps a replacement token when a slower caller also sees the old one rejected', async () => {
      let grants = 0;
      let armed = false;
      let staleSeen = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fetchSpy.mockImplementation(async (url, init) => {
        if ((url as string).endsWith(GRANT_PATH)) {
          return jsonResponse(grantAnswer(`tok-${++grants}`));
        }
        if (armed && headersOf(init as RequestInit).Authorization === 'tok-1') {
          staleSeen += 1;
          if (staleSeen === 2) {
            await gate;
          }
          return jsonResponse({}, 401);
        }
        return jsonResponse(completedAnswer());
      });
      const gateway = build();
      await gateway.queryCheckout('warm-up');
      armed = true;

      const fast = gateway.queryCheckout('PAY-1');
      const slow = gateway.queryCheckout('PAY-2');
      await fast;
      release();
      const [fastResult, slowResult] = [await fast, await slow];

      expect(fastResult.kind).toBe('completed');
      expect(slowResult.kind).toBe('completed');
      expect(grants).toBe(2);
    });

    it('does not retry a rejection that does not name the token', async () => {
      answer(QUERY_PATH, { statusCode: '2023', statusMessage: 'Insufficient Balance' });

      const result = await build().queryCheckout('PAY-1');

      expect(result).toEqual({ kind: 'error', reason: 'bKash answered status code 2023.' });
      expect(sentTo(GRANT_PATH)).toHaveLength(1);
      expect(sentTo(QUERY_PATH)).toHaveLength(1);
    });
  });

  describe('createCheckout', () => {
    it('sends the decimal amount, callback URL, invoice number, mode, intent and currency', async () => {
      answer(CREATE_PATH, { statusCode: '0000', paymentID: 'P', bkashURL: 'https://pay.bka.sh/x' });

      await build().createCheckout(checkoutRequest);

      expect(bodyOf(sentTo(CREATE_PATH)[0])).toEqual({
        mode: '0011',
        payerReference: 'customer-7',
        callbackURL: 'https://api.example.com/api/v1/payments/bkash/callback',
        amount: '1234.50',
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: 'BB-1001',
      });
    });

    it('returns the payment id and the bKash redirect URL on success', async () => {
      answer(CREATE_PATH, {
        statusCode: '0000',
        statusMessage: 'Successful',
        paymentID: 'TR0011abc',
        bkashURL: 'https://sandbox.payment.bkash.com/?paymentId=TR0011abc',
        transactionStatus: 'Initiated',
      });

      const result = await build().createCheckout(checkoutRequest);

      expect(result).toEqual({
        ok: true,
        paymentId: 'TR0011abc',
        redirectUrl: 'https://sandbox.payment.bkash.com/?paymentId=TR0011abc',
      });
    });

    it.each([
      [
        'a non-0000 status code',
        { statusCode: '2065', paymentID: 'P', bkashURL: 'https://x' },
        200,
      ],
      ['an errorCode body', { errorCode: '503', errorMessage: 'Down' }, 200],
      ['a missing paymentID', { statusCode: '0000', bkashURL: 'https://x' }, 200],
      ['a missing bkashURL', { statusCode: '0000', paymentID: 'P' }, 200],
      ['an HTTP 500', { statusCode: '0000', paymentID: 'P', bkashURL: 'https://x' }, 500],
    ])('returns ok false for %s', async (_label, body, status) => {
      answer(CREATE_PATH, body, status);

      const result = await build().createCheckout(checkoutRequest);

      expect(result.ok).toBe(false);
    });

    it('puts only a coerced remote code in the failure reason', async () => {
      answer(CREATE_PATH, { statusCode: '20<script>23', statusMessage: 'token: tok-1' });

      const result = await build().createCheckout(checkoutRequest);

      expect(result).toEqual({
        ok: false,
        failureReason: 'bKash answered status code 20script23.',
      });
    });

    it('returns ok false for a negative amount without calling bKash', async () => {
      const result = await build().createCheckout({ ...checkoutRequest, amountPoysha: -1n });

      expect(result.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['executeCheckout', EXECUTE_PATH],
    ['queryCheckout', QUERY_PATH],
  ] as const)('%s', (method, path) => {
    const run = (): ReturnType<BkashPaymentGateway['executeCheckout']> => build()[method]('PAY-1');

    it('posts the paymentID', async () => {
      answer(path, completedAnswer());

      await run();

      expect(bodyOf(sentTo(path)[0])).toEqual({ paymentID: 'PAY-1' });
    });

    it('maps a complete Completed answer to completed with its details', async () => {
      answer(path, completedAnswer());

      await expect(run()).resolves.toEqual({
        kind: 'completed',
        transactionId: 'TRX-9',
        amountPoysha: 123_450n,
        currency: 'BDT',
        orderNumber: 'BB-1001',
      });
    });

    it.each([
      ['Cancelled', 'cancelled'],
      ['Failed', 'failed'],
      ['Expired', 'expired'],
    ])('maps transactionStatus %s to %s', async (status, kind) => {
      answer(path, completedAnswer({ transactionStatus: status, trxID: undefined }));

      await expect(run()).resolves.toEqual({
        kind,
        reason: `bKash reported the payment as ${status}.`,
      });
    });

    it.each(['Initiated', 'Pending Authorized', 'SomethingNew'])(
      'maps transactionStatus %s to pending',
      async (status) => {
        answer(path, completedAnswer({ transactionStatus: status, trxID: undefined }));

        await expect(run()).resolves.toEqual({ kind: 'pending' });
      },
    );

    it.each([
      ['an empty trxID', { trxID: '' }],
      ['a missing trxID', { trxID: undefined }],
      ['a zero amount', { amount: '0.00' }],
      ['an amount with thousands separator', { amount: '1,250.50' }],
      ['an amount with three decimals', { amount: '12.345' }],
      ['an empty amount', { amount: '' }],
      ['a missing amount', { amount: undefined }],
      ['a numeric amount', { amount: 1234.5 }],
      ['a negative amount', { amount: '-5.00' }],
      ['a missing currency', { currency: undefined }],
      ['a missing merchantInvoiceNumber', { merchantInvoiceNumber: undefined }],
      ['a missing transactionStatus', { transactionStatus: undefined }],
    ])('never infers completion: %s gives error', async (_label, override) => {
      answer(path, completedAnswer(override));

      await expect(run()).resolves.toMatchObject({ kind: 'error' });
    });

    it('gives error for a non-0000 status code even when it says Completed', async () => {
      answer(path, completedAnswer({ statusCode: '2062' }));

      await expect(run()).resolves.toEqual({
        kind: 'error',
        reason: 'bKash answered status code 2062.',
      });
    });

    it('gives error for an errorCode body', async () => {
      answer(path, { errorCode: '503', errorMessage: 'Service down' });

      await expect(run()).resolves.toEqual({
        kind: 'error',
        reason: 'bKash answered status code 503.',
      });
    });

    it('gives error for a non-2xx answer carrying a Completed body', async () => {
      answer(path, completedAnswer(), 502);

      await expect(run()).resolves.toMatchObject({ kind: 'error' });
    });

    it('gives error for an unparseable body', async () => {
      answers[path] = () => new Response('<html>oops</html>', { status: 200 });

      await expect(run()).resolves.toEqual({
        kind: 'error',
        reason: 'bKash sent an unreadable answer.',
      });
    });

    it('gives error for a body that is not an object', async () => {
      answer(path, ['Completed']);

      await expect(run()).resolves.toMatchObject({ kind: 'error' });
    });
  });

  describe('refund', () => {
    const refundRequest = {
      amountPoysha: 50_000n,
      originalReference: 'PAY-1',
      transactionId: 'TRX-9',
    };
    const refundedAnswer = {
      statusCode: '0000',
      statusMessage: 'Successful',
      originalTrxID: 'TRX-9',
      refundTrxID: 'RFND-5',
      transactionStatus: 'Completed',
      amount: '500.00',
      currency: 'BDT',
    };

    it('sends paymentID, the decimal amount, trxID, sku and reason', async () => {
      answer(REFUND_PATH, refundedAnswer);

      await build().refund(refundRequest);

      expect(bodyOf(sentTo(REFUND_PATH)[0])).toEqual({
        paymentID: 'PAY-1',
        amount: '500.00',
        trxID: 'TRX-9',
        sku: 'order',
        reason: 'Order could not accept the payment',
      });
    });

    it('returns ok with the refund transaction id as the reference', async () => {
      answer(REFUND_PATH, refundedAnswer);

      await expect(build().refund(refundRequest)).resolves.toEqual({
        ok: true,
        reference: 'RFND-5',
        pending: false,
        failureReason: null,
        ambiguous: false,
      });
    });

    it.each([
      ['missing', undefined],
      ['blank', ''],
    ])(
      'returns ok with a null reference when a Completed refund has a %s refundTrxID',
      async (_label, refundTrxID) => {
        answer(REFUND_PATH, { ...refundedAnswer, refundTrxID });

        await expect(build().refund(refundRequest)).resolves.toEqual({
          ok: true,
          reference: null,
          pending: false,
          failureReason: null,
          ambiguous: false,
        });
        expect(logger.warn).toHaveBeenCalledWith(
          'bKash refund completed without a refund transaction id',
        );
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('RFND');
      },
    );

    it.each([
      ['a non-0000 status code', { ...refundedAnswer, statusCode: '2029' }, 200],
      ['a numeric non-0000 status code', { ...refundedAnswer, statusCode: 2029 }, 200],
      ['a Failed transactionStatus', { ...refundedAnswer, transactionStatus: 'Failed' }, 200],
      ['an errorCode body', { errorCode: '500', errorMessage: 'x' }, 200],
      ['an HTTP 400 carrying an errorCode', { errorCode: '2023', errorMessage: 'x' }, 400],
      ['an HTTP 403 with a parsed body and no codes', { message: 'Forbidden' }, 403],
    ])(
      'returns a definitive ok false only on a positive refusal: %s',
      async (_label, body, status) => {
        answer(REFUND_PATH, body, status);

        const result = await build().refund(refundRequest);

        expect(result).toMatchObject({
          ok: false,
          reference: null,
          pending: false,
          ambiguous: false,
        });
      },
    );

    it.each([
      [
        '0000 with a missing transactionStatus',
        { ...refundedAnswer, transactionStatus: undefined },
      ],
      [
        '0000 with a Pending transactionStatus',
        { ...refundedAnswer, transactionStatus: 'Pending' },
      ],
      ['0000 with an unknown transactionStatus', { ...refundedAnswer, transactionStatus: 'Odd' }],
      [
        'no statusCode and no errorCode, though it says Completed',
        { ...refundedAnswer, statusCode: undefined },
      ],
      ['an empty object', {}],
      ['a blank statusCode', { ...refundedAnswer, statusCode: '', transactionStatus: undefined }],
    ])(
      'returns an ambiguous ok false for a 2xx that is not a positive refusal: %s',
      async (_label, body) => {
        answer(REFUND_PATH, body);

        await expect(build().refund(refundRequest)).resolves.toMatchObject({
          ok: false,
          reference: null,
          ambiguous: true,
        });
      },
    );

    it('stays ambiguous on an HTTP 500 even when it carries an errorCode', async () => {
      answer(REFUND_PATH, { errorCode: '9999', errorMessage: 'x' }, 500);

      await expect(build().refund(refundRequest)).resolves.toMatchObject({ ambiguous: true });
    });

    it.each([
      ['an HTTP 500, even with a Completed body', () => jsonResponse(refundedAnswer, 500)],
      ['an HTTP 504 with no body', () => new Response('', { status: 504 })],
      ['an unparseable body', () => new Response('<html>oops</html>', { status: 200 })],
      ['a body that is not an object', () => jsonResponse(['Completed'])],
      [
        'a timeout',
        () => {
          const timeout = new Error('The operation was aborted due to timeout');
          timeout.name = 'TimeoutError';
          throw timeout;
        },
      ],
      [
        'a transport fault',
        () => {
          throw new TypeError('network down');
        },
      ],
    ])(
      'returns an ambiguous ok false for %s, because bKash may have refunded',
      async (_label, respond) => {
        answers[REFUND_PATH] = respond;

        await expect(build().refund(refundRequest)).resolves.toMatchObject({
          ok: false,
          reference: null,
          ambiguous: true,
        });
      },
    );

    it('is definitive when the request never left because a credential is missing', async () => {
      await expect(build({ PAYMENT_PASSWORD: undefined }).refund(refundRequest)).resolves.toEqual({
        ok: false,
        reference: null,
        pending: false,
        failureReason: 'bKash could not be reached.',
        ambiguous: false,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('is definitive when no token could be had, so the refund was never sent', async () => {
      answer(GRANT_PATH, { statusCode: '2001', statusMessage: 'Invalid App Key' });

      await expect(build().refund(refundRequest)).resolves.toMatchObject({
        ok: false,
        ambiguous: false,
      });
      expect(sentTo(REFUND_PATH)).toHaveLength(0);
    });

    it('is ambiguous when the retry after an invalid token is lost in transit', async () => {
      let calls = 0;
      answers[REFUND_PATH] = () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse({ statusCode: '2079', statusMessage: 'Invalid Token' }, 401);
        }
        throw new TypeError('network down');
      };

      await expect(build().refund(refundRequest)).resolves.toMatchObject({
        ok: false,
        ambiguous: true,
      });
      expect(sentTo(REFUND_PATH)).toHaveLength(2);
    });

    it('returns ok false without calling bKash when there is no transaction id', async () => {
      const result = await build().refund({ ...refundRequest, transactionId: null });

      expect(result).toEqual({
        ok: false,
        reference: null,
        pending: false,
        failureReason: 'There is no bKash transaction id to refund.',
        ambiguous: false,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('charge', () => {
    it('refuses, because bKash needs a hosted checkout', async () => {
      await expect(
        (build() as PaymentGateway).charge({
          amountPoysha: 100n,
          orderNumber: 'BB-1',
          payerPhone: null,
        }),
      ).resolves.toEqual({
        ok: false,
        reference: null,
        pending: false,
        failureReason: 'This payment method is not available yet.',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('faults', () => {
    it('bounds every call with the 15 second timeout', async () => {
      answer(QUERY_PATH, completedAnswer());

      await build().queryCheckout('PAY-1');

      expect(timeoutSpy).toHaveBeenCalledWith(15_000);
      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      sent().forEach(([, init]) => expect(init.signal).toBeInstanceOf(AbortSignal));
    });

    it('never throws when fetch rejects', async () => {
      fetchSpy.mockRejectedValue(new TypeError('network down'));
      const gateway = build();

      await expect(gateway.createCheckout(checkoutRequest)).resolves.toMatchObject({ ok: false });
      await expect(gateway.executeCheckout('P')).resolves.toMatchObject({ kind: 'error' });
      await expect(gateway.queryCheckout('P')).resolves.toMatchObject({ kind: 'error' });
      await expect(
        gateway.refund({ amountPoysha: 100n, originalReference: 'P', transactionId: 'T' }),
      ).resolves.toMatchObject({ ok: false });
    });

    it('gives error when the call times out', async () => {
      const timeout = new Error('The operation was aborted due to timeout');
      timeout.name = 'TimeoutError';
      answers[QUERY_PATH] = () => {
        throw timeout;
      };

      await expect(build().queryCheckout('PAY-1')).resolves.toEqual({
        kind: 'error',
        reason: 'bKash could not be reached.',
      });
    });

    it('recovers on the next call after a failed grant', async () => {
      answer(QUERY_PATH, completedAnswer());
      answers[GRANT_PATH] = () => {
        throw new Error('down');
      };
      const gateway = build();
      await gateway.queryCheckout('PAY-1');

      answers[GRANT_PATH] = () => jsonResponse(grantAnswer('tok-2'));
      const result = await gateway.queryCheckout('PAY-1');

      expect(result.kind).toBe('completed');
    });
  });

  describe('logging', () => {
    it('never logs a token, credential, header, or full phone number', async () => {
      answer(QUERY_PATH, completedAnswer());
      answer(CREATE_PATH, {
        statusCode: '2023',
        statusMessage: 'bad tok-1',
        payerAccount: '01712345678',
      });
      const gateway = build();

      await gateway.queryCheckout('PAY-1');
      await gateway.createCheckout(checkoutRequest);
      await gateway.refund({ amountPoysha: 1n, originalReference: 'P', transactionId: null });
      fetchSpy.mockRejectedValue(new Error('boom tok-1 app-secret-value merchant-pass'));
      await build().executeCheckout('PAY-1');
      await build({ PAYMENT_USERNAME: undefined }).executeCheckout('PAY-1');

      const logged = JSON.stringify([
        ...logger.error.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.info.mock.calls,
        ...logger.debug.mock.calls,
      ]);
      expect(logger.error).toHaveBeenCalled();
      for (const secret of [
        'tok-1',
        'refresh-of-tok-1',
        APP_KEY,
        APP_SECRET,
        USERNAME,
        PASSWORD,
        '01712345678',
        'boom',
      ]) {
        expect(logged).not.toContain(secret);
      }
    });

    it('logs a thrown error by name only', async () => {
      fetchSpy.mockRejectedValue(new TypeError('secret detail'));

      await build().queryCheckout('PAY-1');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ errorName: 'TypeError' }),
        expect.any(String),
      );
    });
  });
});

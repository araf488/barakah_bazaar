import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { AlphaSmsGateway } from './alpha-sms.gateway';

const API_URL = 'https://api.sms.net.bd/sendsms';
const message = { to: '+8801712345678', body: 'Barakah Bazaar code: 482913. Valid 5 minutes.' };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AlphaSmsGateway', () => {
  let logger: jest.Mocked<PinoLogger>;
  let fetchSpy: jest.SpyInstance;

  const build = (extra: Record<string, unknown> = {}): AlphaSmsGateway =>
    new AlphaSmsGateway(
      createMockConfig({
        SMS_API_URL: API_URL,
        SMS_API_KEY: 'secret-key',
        SMS_SENDER_ID: 'BARAKAH',
        ...extra,
      }),
      logger,
    );

  const sentBody = (): URLSearchParams => {
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    return new URLSearchParams(init.body as string);
  };

  beforeEach(() => {
    logger = createMockLogger();
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({ error: 0, msg: 'Request successfully submitted', data: { request_id: 1 } }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('posts a form-encoded request to SMS_API_URL', async () => {
    await build().send(message);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(API_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  it('sends api_key, msg, to and sender_id with the number as 880XXXXXXXXXX', async () => {
    await build().send(message);

    const body = sentBody();
    expect(body.get('api_key')).toBe('secret-key');
    expect(body.get('msg')).toBe('Barakah Bazaar code: 482913. Valid 5 minutes.');
    expect(body.get('to')).toBe('8801712345678');
    expect(body.get('sender_id')).toBe('BARAKAH');
  });

  it('keeps the api key out of the URL', async () => {
    await build().send(message);

    expect(fetchSpy.mock.calls[0][0]).not.toContain('secret-key');
  });

  it('prefers the sender id on the message over the configured one', async () => {
    await build().send({ ...message, senderId: 'OTHER' });

    expect(sentBody().get('sender_id')).toBe('OTHER');
  });

  it('omits sender_id when none is configured', async () => {
    await build({ SMS_SENDER_ID: undefined }).send(message);

    expect(sentBody().has('sender_id')).toBe(false);
  });

  it('passes an abort signal so a hung gateway cannot hold the request', async () => {
    await build().send(message);

    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('answers true when the body reports error 0', async () => {
    await expect(build().send(message)).resolves.toBe(true);
  });

  it('answers false for a documented error body, even on HTTP 200', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 417, msg: 'Insufficient balance' }));

    await expect(build().send(message)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('logs the remote error code as a number, never the raw remote value', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: '417' }));

    await build().send(message);

    expect(logger.error).toHaveBeenCalledWith(
      { to: '678', errorCode: 417 },
      'Alpha SMS rejected the message',
    );
  });

  it('logs a non-numeric remote error as NaN, so arbitrary remote text never reaches the log', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'injected <script> 01712345678' }));

    await build().send(message);

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('injected');
    expect(logger.error.mock.calls[0][0]).toEqual({ to: '678', errorCode: NaN });
  });

  it('answers false for a non-2xx status', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 0 }, 500));

    await expect(build().send(message)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('answers false for a body that is not JSON', async () => {
    fetchSpy.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));

    await expect(build().send(message)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('answers false and does not throw when fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(build().send(message)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('answers false without calling fetch when the URL or key is missing', async () => {
    await expect(build({ SMS_API_KEY: undefined }).send(message)).resolves.toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it.each([
    ['a gateway error body', () => jsonResponse({ error: 413, msg: 'Invalid Sender ID' })],
    ['a non-2xx status', () => jsonResponse({}, 503)],
    ['a rejected fetch', () => Promise.reject(new Error('boom 01712345678 482913'))],
  ])('never logs the body or the full number on %s', async (_label, respond) => {
    fetchSpy.mockImplementation(respond);

    await build().send(message);

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('482913');
    expect(logged).not.toContain('01712345678');
    expect(logged).not.toContain('secret-key');
    expect(logged).toContain('678');
  });
});

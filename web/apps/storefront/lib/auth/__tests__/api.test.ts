import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { authApi, callApiExplained, sessionTokensOf } from '../api';

const CALLER = { deviceId: 'device-1', userAgent: 'Mozilla/5.0 test' };

describe('authApi', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('posts JSON to the API with the device id and the browser’s user agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ kind: 'session' }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.login(CALLER, 'a@b.co', 'secret password');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/auth/login');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ email: 'a@b.co', password: 'secret password' }),
    });
    expect(init.headers).toMatchObject({
      'X-Device-Id': 'device-1',
      'User-Agent': 'Mozilla/5.0 test',
      'Content-Type': 'application/json',
    });
  });

  it('sends the access token as a bearer token when it has one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'u1' }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.me({ ...CALLER, accessToken: 'at' });

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer at',
    });
  });

  it('returns the status of a refused call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(authApi.login(CALLER, 'a@b.co', 'x')).resolves.toEqual({ ok: false, status: 401 });
  });

  it('reports an unreachable API as status 0', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(authApi.forgotPassword(CALLER, 'a@b.co')).resolves.toEqual({
      ok: false,
      status: 0,
    });
  });

  it('accepts an empty 204 answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(authApi.logout({ ...CALLER, accessToken: 'at' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
  });
});

describe('callApiExplained', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps the message of a refusal, for refusals that share a status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'Your basket is empty.' }, 409)),
    );
    await expect(callApiExplained('POST', '/orders', CALLER)).resolves.toEqual({
      ok: false,
      status: 409,
      message: 'Your basket is empty.',
    });
  });

  it('has no message when the refusal body carries none or is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 1 }, 400)));
    await expect(callApiExplained('POST', '/orders', CALLER)).resolves.toEqual({
      ok: false,
      status: 400,
      message: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })));
    await expect(callApiExplained('GET', '/orders', CALLER)).resolves.toEqual({
      ok: false,
      status: 502,
      message: null,
    });
  });

  it('reports an unreachable API as status 0 with no message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(callApiExplained('GET', '/orders', CALLER)).resolves.toEqual({
      ok: false,
      status: 0,
      message: null,
    });
  });

  it('returns the body of a success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: 'o1' }, 201)));
    await expect(callApiExplained('POST', '/orders', CALLER, {})).resolves.toEqual({
      ok: true,
      data: { id: 'o1' },
    });
  });
});

describe('sessionTokensOf', () => {
  it('extracts a complete session', () => {
    expect(
      sessionTokensOf({
        kind: 'session',
        accessToken: 'a',
        expiresAt: 'e',
        refreshToken: 'r',
        refreshExpiresAt: 're',
      }),
    ).toEqual({ accessToken: 'a', expiresAt: 'e', refreshToken: 'r', refreshExpiresAt: 're' });
  });

  it('refuses an answer without a full session, such as an MFA challenge', () => {
    expect(sessionTokensOf({ kind: 'mfa', mfaToken: 'm' })).toBeNull();
  });
});

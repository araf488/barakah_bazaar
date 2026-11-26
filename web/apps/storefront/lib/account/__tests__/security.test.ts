import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';

vi.mock('../caller', () => ({
  accountCaller: vi.fn(async () => ({ deviceId: 'd', accessToken: 'at' })),
}));

const { getDeviceSessions, securityApi } = await import('../security');
const { accountCaller } = await import('../caller');

const CALLER = { deviceId: 'd', accessToken: 'at', clientIp: '203.0.113.7' };

const session = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  deviceId: `device-${id}`,
  userAgent: null,
  ipAddress: '203.0.113.0',
  createdAt: '2026-11-20T08:00:00.000Z',
  lastUsedAt: null,
  current: false,
  ...overrides,
});

describe('securityApi', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('lists the sessions as the signed-in visitor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('s1')]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(securityApi.sessions(CALLER)).resolves.toEqual({
      ok: true,
      data: [session('s1')],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/auth/sessions');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer at',
      'X-Forwarded-For': '203.0.113.7',
    });
  });

  it('ends one session by its id, escaped', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(securityApi.endSession(CALLER, 'a/b')).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/auth/sessions/a%2Fb');
    expect(init.method).toBe('DELETE');
  });

  it('ends every session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ revoked: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(securityApi.endAllSessions(CALLER)).resolves.toEqual({
      ok: true,
      data: { revoked: 3 },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/auth/logout-all');
    expect(init.method).toBe('POST');
  });

  it('changes the password and keeps the refusal message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Those sign-in details are not correct.' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const result = await securityApi.changePassword(CALLER, {
      currentPassword: 'old',
      newPassword: 'Mango-season-2026',
    });

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Those sign-in details are not correct.',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/auth/password');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(
      JSON.stringify({ currentPassword: 'old', newPassword: 'Mango-season-2026' }),
    );
  });
});

describe('getDeviceSessions', () => {
  beforeEach(() => vi.spyOn(securityApi, 'sessions'));
  afterEach(() => vi.restoreAllMocks());

  it('puts this device first, then the most recently used', async () => {
    vi.mocked(securityApi.sessions).mockResolvedValue({
      ok: true,
      data: [
        session('old', { lastUsedAt: '2026-11-21T08:00:00.000Z' }),
        session('never-used', { createdAt: '2026-11-22T08:00:00.000Z' }),
        session('here', { current: true, lastUsedAt: '2026-11-20T08:00:00.000Z' }),
        session('recent', { lastUsedAt: '2026-11-25T08:00:00.000Z' }),
      ],
    });

    const outcome = await getDeviceSessions();

    expect(outcome.ok && outcome.sessions.map((s) => s.id)).toEqual([
      'here',
      'recent',
      'never-used',
      'old',
    ]);
  });

  it('reports a failed load as a value', async () => {
    vi.mocked(securityApi.sessions).mockResolvedValue({ ok: false, status: 503 });
    await expect(getDeviceSessions()).resolves.toEqual({ ok: false });
  });

  it('has nothing to show without a session, and asks the API nothing', async () => {
    vi.mocked(accountCaller).mockResolvedValueOnce(null);
    await expect(getDeviceSessions()).resolves.toEqual({ ok: false });
    expect(securityApi.sessions).not.toHaveBeenCalled();
  });
});

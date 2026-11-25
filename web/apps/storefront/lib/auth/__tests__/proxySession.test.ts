// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { maintainSession } from '../proxySession';

const SESSION = {
  kind: 'session',
  accessToken: 'new-at',
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  refreshToken: 'new-rt',
  refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

const requestWith = (cookie: string) =>
  new NextRequest('http://localhost/bn', { headers: cookie ? { cookie } : {} });

describe('maintainSession', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('gives a first-time visitor a device id', async () => {
    const response = NextResponse.next();
    await maintainSession(requestWith(''), response);
    expect(response.cookies.get('bb_device')?.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('leaves a live session alone', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = NextResponse.next();

    await maintainSession(requestWith('bb_device=d; bb_session=at; bb_refresh=rt'), response);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });

  it('trades a lapsed access cookie for a new session with the same device id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SESSION));
    vi.stubGlobal('fetch', fetchMock);
    const response = NextResponse.next();

    await maintainSession(requestWith('bb_device=d; bb_refresh=rt'), response);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/auth/refresh');
    expect(init.body).toBe(JSON.stringify({ refreshToken: 'rt' }));
    expect(init.headers).toMatchObject({ 'X-Device-Id': 'd' });
    expect(response.cookies.get('bb_session')?.value).toBe('new-at');
    expect(response.cookies.get('bb_refresh')?.value).toBe('new-rt');
  });

  it('signs the visitor out when the refresh token is dead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    const response = NextResponse.next();

    await maintainSession(requestWith('bb_device=d; bb_refresh=rt'), response);

    expect(response.cookies.get('bb_refresh')?.value).toBe('');
  });

  it('keeps the refresh cookie when the API is only unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const response = NextResponse.next();

    await maintainSession(requestWith('bb_device=d; bb_refresh=rt'), response);

    expect(response.cookies.getAll()).toEqual([]);
  });
});

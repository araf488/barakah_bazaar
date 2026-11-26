// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { isAdminPath, maintainStaffSession } from '../proxySession';

const SESSION = {
  kind: 'session',
  portal: 'ADMIN',
  accessToken: 'new-at',
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  refreshToken: 'new-rt',
  refreshExpiresAt: new Date(Date.now() + 43_200_000).toISOString(),
};

const requestWith = (cookie: string) =>
  new NextRequest('http://localhost/admin', { headers: cookie ? { cookie } : {} });

describe('isAdminPath', () => {
  it.each(['/admin', '/admin/', '/admin/sign-in'])('treats %s as the portal', (path) => {
    expect(isAdminPath(path)).toBe(true);
  });

  it.each(['/administrator', '/bn/admin', '/'])('leaves %s to the shop', (path) => {
    expect(isAdminPath(path)).toBe(false);
  });
});

describe('maintainStaffSession', () => {
  beforeEach(() => vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://api.internal/api/v1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('gives a first-time browser a device id', async () => {
    const response = NextResponse.next();
    await maintainStaffSession(requestWith(''), response);
    expect(response.cookies.get('bb_device')?.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('leaves a live staff session alone, and never looks at the shop’s cookies', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = NextResponse.next();

    await maintainStaffSession(
      requestWith('bb_device=d; bb_staff_session=at; bb_staff_refresh=rt; bb_refresh=customer'),
      response,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });

  it('trades a lapsed staff access cookie for a new session, on /admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SESSION));
    vi.stubGlobal('fetch', fetchMock);
    const response = NextResponse.next();

    await maintainStaffSession(requestWith('bb_device=d; bb_staff_refresh=old-rt'), response);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal/api/v1/auth/refresh');
    expect(init.body).toBe(JSON.stringify({ refreshToken: 'old-rt' }));
    expect(response.cookies.get('bb_staff_session')).toMatchObject({
      value: 'new-at',
      path: '/admin',
    });
    expect(response.cookies.get('bb_staff_refresh')).toMatchObject({
      value: 'new-rt',
      path: '/admin',
    });
  });

  it('ends the staff session when the refresh token is dead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    const response = NextResponse.next();

    await maintainStaffSession(requestWith('bb_device=d; bb_staff_refresh=dead'), response);

    expect(response.cookies.get('bb_staff_refresh')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('keeps the cookies when the API is only unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const response = NextResponse.next();

    await maintainStaffSession(requestWith('bb_device=d; bb_staff_refresh=rt'), response);

    expect(response.cookies.getAll()).toEqual([]);
  });
});

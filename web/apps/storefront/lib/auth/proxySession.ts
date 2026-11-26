import type { NextRequest, NextResponse } from 'next/server';

import { authApi, sessionTokensOf } from './api';
import { browserOf } from './browser';
import { clearSession, SESSION_COOKIE, writeDeviceId, writeSession } from './cookies';

/** Refresh answers that mean the refresh token itself is dead, not that the API is down. */
const DEAD_REFRESH_STATUSES = new Set([400, 401, 403]);

/**
 * Runs in the proxy before every page render, the only place a render can still set cookies:
 * gives a new visitor a device id, and trades an expired access cookie for a new session while
 * the refresh cookie is alive. A dead refresh token signs the visitor out; an unreachable API
 * leaves the cookies alone so a blip does not end the session.
 */
export const maintainSession = async (
  request: NextRequest,
  response: NextResponse,
): Promise<void> => {
  let deviceId = request.cookies.get(SESSION_COOKIE.device)?.value;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    writeDeviceId(response.cookies, deviceId);
  }

  const refreshToken = request.cookies.get(SESSION_COOKIE.refresh)?.value;
  if (request.cookies.has(SESSION_COOKIE.access) || !refreshToken) {
    return;
  }

  const result = await authApi.refresh({ deviceId, ...browserOf(request.headers) }, refreshToken);
  const tokens = result.ok ? sessionTokensOf(result.data) : null;
  if (tokens) {
    writeSession(response.cookies, tokens);
  } else if (!result.ok && DEAD_REFRESH_STATUSES.has(result.status)) {
    clearSession(response.cookies);
  }
};

import type { NextRequest, NextResponse } from 'next/server';

import { authApi, sessionTokensOf } from '../auth/api';
import { browserOf } from '../auth/browser';
import { SESSION_COOKIE, writeDeviceId } from '../auth/cookies';
import { clearStaffSession, STAFF_COOKIE, writeStaffSession } from './cookies';
import { ADMIN_ROUTES } from './routes';

/** Refresh answers that mean the refresh token itself is dead, not that the API is down. */
const DEAD_REFRESH_STATUSES = new Set([400, 401, 403]);

/** True for `/admin` and everything under it; `/administrator` is the storefront's. */
export const isAdminPath = (pathname: string): boolean =>
  pathname === ADMIN_ROUTES.home || pathname.startsWith(`${ADMIN_ROUTES.home}/`);

/**
 * The storefront's `maintainSession`, for staff cookies: a device id for a new browser, and a
 * lapsed staff access cookie traded for a new session while the refresh cookie lives. A dead
 * refresh token ends the staff session; an unreachable API leaves it alone.
 */
export const maintainStaffSession = async (
  request: NextRequest,
  response: NextResponse,
): Promise<void> => {
  let deviceId = request.cookies.get(SESSION_COOKIE.device)?.value;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    writeDeviceId(response.cookies, deviceId);
  }

  const refreshToken = request.cookies.get(STAFF_COOKIE.refresh)?.value;
  if (request.cookies.has(STAFF_COOKIE.access) || !refreshToken) {
    return;
  }

  const result = await authApi.refresh({ deviceId, ...browserOf(request.headers) }, refreshToken);
  const tokens = result.ok ? sessionTokensOf(result.data) : null;
  if (tokens) {
    writeStaffSession(response.cookies, tokens);
  } else if (!result.ok && DEAD_REFRESH_STATUSES.has(result.status)) {
    clearStaffSession(response.cookies);
  }
};

import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { type AuthUser, authApi } from './api';
import { browserOf } from './browser';
import { SESSION_COOKIE } from './cookies';

/**
 * The signed-in customer for this render, or `null`. Reads the httpOnly access cookie and asks
 * the API who it belongs to (roles are read from the database there, never from the token).
 * Cached per request, so the header and the page share one call.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  const accessToken = jar.get(SESSION_COOKIE.access)?.value;
  const deviceId = jar.get(SESSION_COOKIE.device)?.value;
  if (!accessToken || !deviceId) {
    return null;
  }
  const result = await authApi.me({ deviceId, accessToken, ...browserOf(incoming) });
  return result.ok ? result.data : null;
});

import { cookies, headers } from 'next/headers';

import type { CallerContext } from '../auth/api';
import { SESSION_COOKIE } from '../auth/cookies';

/**
 * The signed-in caller for an account call (address book, profile), or `null` without an
 * access cookie. Works in server components and actions alike: it only reads.
 */
export const accountCaller = async (): Promise<CallerContext | null> => {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  const accessToken = jar.get(SESSION_COOKIE.access)?.value;
  const deviceId = jar.get(SESSION_COOKIE.device)?.value;
  if (!accessToken || !deviceId) {
    return null;
  }
  return { deviceId, accessToken, userAgent: incoming.get('user-agent') };
};

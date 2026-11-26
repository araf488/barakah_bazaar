import { cookies, headers } from 'next/headers';

import type { CallerContext } from './api';
import { browserOf } from './browser';
import { SESSION_COOKIE, writeDeviceId } from './cookies';

/**
 * The caller context for an API call made from a Server Action: the device id cookie (created
 * here if the proxy has not set one yet) and the browser's user agent and address, so the API's
 * session list and rate limits see the real visitor rather than the Next server.
 */
export const callerFromAction = async (): Promise<CallerContext> => {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  let deviceId = jar.get(SESSION_COOKIE.device)?.value;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    writeDeviceId(jar, deviceId);
  }
  return { deviceId, ...browserOf(incoming) };
};

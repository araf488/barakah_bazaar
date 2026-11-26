import { cache } from 'react';

import { type CallerContext, callApi, callApiExplained } from '../auth/api';
import { accountCaller } from './caller';

// Server-side client for the API's own-session endpoints (src/modules/auth/auth.controller.ts):
// the devices signed in to the account, and the password that guards them.

/** One signed-in device, as `GET /auth/sessions` reports it. */
export interface DeviceSession {
  id: string;
  deviceId: string;
  userAgent: string | null;
  /** Already truncated by the API (a /24 or a /64), or `null` when it could not classify it. */
  ipAddress: string | null;
  createdAt: string;
  /** `null` until the session is first used after sign-in. */
  lastUsedAt: string | null;
  /** The session this browser is using. */
  current: boolean;
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

const SESSIONS_PATH = '/auth/sessions';

export const securityApi = {
  sessions: (caller: CallerContext) => callApi<DeviceSession[]>('GET', SESSIONS_PATH, caller),
  /** Ends one of the caller's own sessions; 404 when it is not theirs or already ended. */
  endSession: (caller: CallerContext, id: string) =>
    callApi<undefined>('DELETE', `${SESSIONS_PATH}/${encodeURIComponent(id)}`, caller),
  /** Ends every session, this one included. */
  endAllSessions: (caller: CallerContext) =>
    callApi<{ revoked: number }>('POST', '/auth/logout-all', caller),
  /** Keeps the refusal's message: a weak password and a wrong current one need telling apart. */
  changePassword: (caller: CallerContext, input: PasswordChange) =>
    callApiExplained<undefined>('PATCH', '/auth/password', caller, input),
};

export type DeviceSessions = { ok: true; sessions: DeviceSession[] } | { ok: false };

const lastSeen = (session: DeviceSession): number =>
  Date.parse(session.lastUsedAt ?? session.createdAt);

/**
 * The customer's signed-in devices: this one first, then the most recently used. A failure is a
 * value the page shows, not an error page.
 */
export const getDeviceSessions = cache(async (): Promise<DeviceSessions> => {
  const caller = await accountCaller();
  if (!caller) {
    return { ok: false };
  }
  const result = await securityApi.sessions(caller);
  if (!result.ok) {
    return { ok: false };
  }
  const sessions = [...result.data].sort(
    (a, b) => Number(b.current) - Number(a.current) || lastSeen(b) - lastSeen(a),
  );
  return { ok: true, sessions };
});

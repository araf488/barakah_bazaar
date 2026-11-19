/**
 * The storefront keeps the API's tokens in httpOnly cookies, so page script can never read them
 * (the BFF model chosen 2026-11-19). The browser only ever holds opaque cookies; the Next server
 * reads them and calls the API on the visitor's behalf.
 */
export const SESSION_COOKIE = {
  /** Access token; expires with the token itself. */
  access: 'bb_session',
  /** Refresh token; the proxy trades it for a new access token when that one has lapsed. */
  refresh: 'bb_refresh',
  /** Pending MFA challenge between the password step and the code step. */
  mfa: 'bb_mfa',
  /** The install's device id, sent as `X-Device-Id` on every call that touches a session. */
  device: 'bb_device',
} as const;

/** How long a pending MFA challenge may sit before the visitor must enter the password again. */
export const MFA_COOKIE_MAX_AGE_SECONDS = 300;

/** Browsers cap cookie lifetime at 400 days; the device id lives that long. */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const MS_PER_SECOND = 1000;

/**
 * httpOnly: no script can read a token. Secure: never sent over plain http (localhost counts as
 * secure in every current browser). SameSite=Lax: not sent on cross-site form posts.
 */
export const COOKIE_BASE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

/** Whole seconds from now until `iso`, never negative. */
export const secondsUntil = (iso: string, now: number = Date.now()): number =>
  Math.max(0, Math.floor((Date.parse(iso) - now) / MS_PER_SECOND));

/** Anything with a cookie jar Next hands out: `cookies()` in actions, `response.cookies` in the proxy. */
export interface CookieWriter {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
}

export interface SessionTokens {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export const writeSession = (jar: CookieWriter, tokens: SessionTokens, now?: number): void => {
  jar.set(SESSION_COOKIE.access, tokens.accessToken, {
    ...COOKIE_BASE,
    maxAge: secondsUntil(tokens.expiresAt, now),
  });
  jar.set(SESSION_COOKIE.refresh, tokens.refreshToken, {
    ...COOKIE_BASE,
    maxAge: secondsUntil(tokens.refreshExpiresAt, now),
  });
  jar.delete(SESSION_COOKIE.mfa);
};

export const clearSession = (jar: CookieWriter): void => {
  jar.delete(SESSION_COOKIE.access);
  jar.delete(SESSION_COOKIE.refresh);
  jar.delete(SESSION_COOKIE.mfa);
};

export const writeMfaChallenge = (jar: CookieWriter, mfaToken: string): void => {
  jar.set(SESSION_COOKIE.mfa, mfaToken, { ...COOKIE_BASE, maxAge: MFA_COOKIE_MAX_AGE_SECONDS });
};

export const writeDeviceId = (jar: CookieWriter, deviceId: string): void => {
  jar.set(SESSION_COOKIE.device, deviceId, {
    ...COOKIE_BASE,
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
};

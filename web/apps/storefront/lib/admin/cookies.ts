import { COOKIE_BASE, type CookieWriter, type SessionTokens, secondsUntil } from '../auth/cookies';

/**
 * Staff tokens live in their own httpOnly cookies, scoped to `/admin`: a customer session and a
 * staff session in one browser never collide, and no storefront page is ever sent a staff token.
 * The device id cookie is shared with the storefront: it names the browser, not the person.
 */
export const STAFF_COOKIE = {
  access: 'bb_staff_session',
  refresh: 'bb_staff_refresh',
  /** The pending second step between the password and a session: `mfa:<token>` or `enrolment:<token>`. */
  challenge: 'bb_staff_challenge',
} as const;

/** The only path staff cookies are sent to. */
export const STAFF_COOKIE_PATH = '/admin';

/** How long the API's MFA and enrolment tokens live (`AuthConstants.MfaTokenMinutes`). */
export const STAFF_CHALLENGE_MAX_AGE_SECONDS = 300;

/**
 * Strict, not Lax: no admin request made from another site carries a staff cookie, not even a
 * top-level link. A staff member following a link from email lands on sign-in, which is fine.
 */
const STAFF_COOKIE_BASE = { ...COOKIE_BASE, sameSite: 'strict', path: STAFF_COOKIE_PATH } as const;

export type ChallengeKind = 'mfa' | 'enrolment';

export interface StaffChallenge {
  kind: ChallengeKind;
  token: string;
}

const CHALLENGE_SEPARATOR = ':';

/** Expires a staff cookie. `delete(name)` would target path `/` and miss these. */
const expire = (jar: CookieWriter, name: string): void => {
  jar.set(name, '', { ...STAFF_COOKIE_BASE, maxAge: 0 });
};

export const writeStaffSession = (jar: CookieWriter, tokens: SessionTokens, now?: number): void => {
  jar.set(STAFF_COOKIE.access, tokens.accessToken, {
    ...STAFF_COOKIE_BASE,
    maxAge: secondsUntil(tokens.expiresAt, now),
  });
  jar.set(STAFF_COOKIE.refresh, tokens.refreshToken, {
    ...STAFF_COOKIE_BASE,
    maxAge: secondsUntil(tokens.refreshExpiresAt, now),
  });
  expire(jar, STAFF_COOKIE.challenge);
};

export const clearStaffSession = (jar: CookieWriter): void => {
  expire(jar, STAFF_COOKIE.access);
  expire(jar, STAFF_COOKIE.refresh);
  expire(jar, STAFF_COOKIE.challenge);
};

export const writeStaffChallenge = (jar: CookieWriter, challenge: StaffChallenge): void => {
  jar.set(STAFF_COOKIE.challenge, `${challenge.kind}${CHALLENGE_SEPARATOR}${challenge.token}`, {
    ...STAFF_COOKIE_BASE,
    maxAge: STAFF_CHALLENGE_MAX_AGE_SECONDS,
  });
};

export const clearStaffChallenge = (jar: CookieWriter): void => {
  expire(jar, STAFF_COOKIE.challenge);
};

/** The pending challenge of the given kind, or `null` when there is none or it is the other kind. */
export const readStaffChallenge = (
  value: string | undefined,
  kind: ChallengeKind,
): string | null => {
  const prefix = `${kind}${CHALLENGE_SEPARATOR}`;
  if (!value?.startsWith(prefix)) {
    return null;
  }
  return value.slice(prefix.length) || null;
};

import { serverApiBaseUrl } from '../api/config';
import type { SessionTokens } from './cookies';

// Server-side client for the API's auth module (src/modules/auth). Never imported by client
// code: the browser talks to Server Actions, which call these.

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  phoneVerified: boolean;
  role: string;
  createdAt: string;
}

export interface LoginResponse extends Partial<SessionTokens> {
  kind: 'session' | 'mfa' | 'enrolment';
  portal?: 'ADMIN' | 'STOREFRONT';
  user?: AuthUser;
  mfaToken?: string;
  enrolmentToken?: string;
}

/** The outcome of one auth call: the body, or the status that refused it (0 = unreachable). */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; status: number };

/** Who is calling: the install's device id and, when known, the browser's user agent. */
export interface CallerContext {
  deviceId: string;
  userAgent?: string | null;
  accessToken?: string;
}

/** Status reported when the API could not be reached at all. */
export const UNREACHABLE_STATUS = 0;

const DEVICE_ID_HEADER = 'X-Device-Id';
const JSON_MEDIA_TYPE = 'application/json';
const NO_CONTENT_STATUS = 204;

const headersFor = (caller: CallerContext): Record<string, string> => ({
  Accept: JSON_MEDIA_TYPE,
  'Content-Type': JSON_MEDIA_TYPE,
  [DEVICE_ID_HEADER]: caller.deviceId,
  ...(caller.userAgent ? { 'User-Agent': caller.userAgent } : {}),
  ...(caller.accessToken ? { Authorization: `Bearer ${caller.accessToken}` } : {}),
});

/**
 * One call to the API on the visitor's behalf, from server code only. `path` is under the API
 * prefix (`/auth/login`, `/cart/items`). Never throws: a refusal or an unreachable API is a value.
 */
export const callApi = async <T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  caller: CallerContext,
  body?: unknown,
): Promise<AuthResult<T>> => {
  try {
    const res = await fetch(`${serverApiBaseUrl()}${path}`, {
      method,
      headers: headersFor(caller),
      cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const data = res.status === NO_CONTENT_STATUS ? undefined : await res.json();
    return { ok: true, data: data as T };
  } catch (error) {
    console.error('API unreachable', error);
    return { ok: false, status: UNREACHABLE_STATUS };
  }
};

export const authApi = {
  login: (caller: CallerContext, email: string, password: string) =>
    callApi<LoginResponse>('POST', '/auth/login', caller, { email, password }),
  loginMfa: (
    caller: CallerContext,
    mfaToken: string,
    proof: { code: string } | { recoveryCode: string },
  ) => callApi<LoginResponse>('POST', '/auth/login/mfa', caller, { mfaToken, ...proof }),
  refresh: (caller: CallerContext, refreshToken: string) =>
    callApi<LoginResponse>('POST', '/auth/refresh', caller, { refreshToken }),
  logout: (caller: CallerContext) => callApi<undefined>('POST', '/auth/logout', caller),
  me: (caller: CallerContext) => callApi<AuthUser>('GET', '/auth/me', caller),
  register: (
    caller: CallerContext,
    input: { email: string; password: string; fullName: string; preferredLanguage: 'BN' | 'EN' },
  ) => callApi<{ status: string }>('POST', '/auth/register', caller, input),
  verifyEmail: (
    caller: CallerContext,
    proof: { token: string } | { email: string; code: string },
  ) => callApi<{ emailVerified: boolean }>('POST', '/auth/verify-email', caller, proof),
  resendVerification: (caller: CallerContext, email: string) =>
    callApi<{ status: string }>('POST', '/auth/resend-verification', caller, { email }),
  forgotPassword: (caller: CallerContext, email: string) =>
    callApi<{ status: string }>('POST', '/auth/forgot-password', caller, { email }),
  resetPassword: (
    caller: CallerContext,
    input: ({ token: string } | { email: string; code: string }) & { newPassword: string },
  ) => callApi<{ passwordReset: boolean }>('POST', '/auth/reset-password', caller, input),
};

/** A login answer that carries a complete session, narrowed for cookie writing. */
export const sessionTokensOf = (res: LoginResponse): SessionTokens | null =>
  res.accessToken && res.expiresAt && res.refreshToken && res.refreshExpiresAt
    ? {
        accessToken: res.accessToken,
        expiresAt: String(res.expiresAt),
        refreshToken: res.refreshToken,
        refreshExpiresAt: String(res.refreshExpiresAt),
      }
    : null;

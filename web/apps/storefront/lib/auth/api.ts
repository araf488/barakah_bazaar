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

const call = async <T>(
  method: 'GET' | 'POST',
  path: string,
  caller: CallerContext,
  body?: unknown,
): Promise<AuthResult<T>> => {
  try {
    const res = await fetch(`${serverApiBaseUrl()}/auth${path}`, {
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
    console.error('Auth API unreachable', error);
    return { ok: false, status: UNREACHABLE_STATUS };
  }
};

export const authApi = {
  login: (caller: CallerContext, email: string, password: string) =>
    call<LoginResponse>('POST', '/login', caller, { email, password }),
  loginMfa: (
    caller: CallerContext,
    mfaToken: string,
    proof: { code: string } | { recoveryCode: string },
  ) => call<LoginResponse>('POST', '/login/mfa', caller, { mfaToken, ...proof }),
  refresh: (caller: CallerContext, refreshToken: string) =>
    call<LoginResponse>('POST', '/refresh', caller, { refreshToken }),
  logout: (caller: CallerContext) => call<undefined>('POST', '/logout', caller),
  me: (caller: CallerContext) => call<AuthUser>('GET', '/me', caller),
  register: (
    caller: CallerContext,
    input: { email: string; password: string; fullName: string; preferredLanguage: 'BN' | 'EN' },
  ) => call<{ status: string }>('POST', '/register', caller, input),
  verifyEmail: (
    caller: CallerContext,
    proof: { token: string } | { email: string; code: string },
  ) => call<{ emailVerified: boolean }>('POST', '/verify-email', caller, proof),
  resendVerification: (caller: CallerContext, email: string) =>
    call<{ status: string }>('POST', '/resend-verification', caller, { email }),
  forgotPassword: (caller: CallerContext, email: string) =>
    call<{ status: string }>('POST', '/forgot-password', caller, { email }),
  resetPassword: (
    caller: CallerContext,
    input: ({ token: string } | { email: string; code: string }) & { newPassword: string },
  ) => call<{ passwordReset: boolean }>('POST', '/reset-password', caller, input),
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

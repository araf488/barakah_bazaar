'use server';

import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';

import { redirect } from '../../i18n/navigation';
import {
  type AuthResult,
  authApi,
  type ExplainedResult,
  type LoginResponse,
  sessionTokensOf,
} from './api';
import { mergeGuestCart } from '../cart/merge';
import { callerFromAction } from './caller';
import { clearSession, SESSION_COOKIE, writeMfaChallenge, writeSession } from './cookies';
import { type AuthErrorKey, authErrorFor } from './errors';
import { type PasswordPolicyError, passwordPolicyErrorOf } from './passwordPolicy';
import {
  checkCode,
  checkEmail,
  checkNewPassword,
  type FieldError,
  FULL_NAME_MAX_LENGTH,
  safeNextPath,
} from './rules';

/** What a form shows after its action ran. `sent` and `done` are the success screens. */
export type AuthFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      error: AuthErrorKey | FieldError | PasswordPolicyError | 'staffPortal' | 'mfaExpired';
    }
  | { status: 'mfa' }
  | { status: 'sent'; email: string }
  | { status: 'done' };

const field = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

/** Passwords are never trimmed: a trailing space is a character the user chose. */
const secret = (form: FormData, name: string): string => String(form.get(name) ?? '');

const fail = (error: Extract<AuthFormState, { status: 'error' }>['error']): AuthFormState => ({
  status: 'error',
  error,
});

const refused = (result: AuthResult<unknown>): AuthFormState =>
  result.ok ? { status: 'idle' } : fail(authErrorFor(result.status));

const BAD_REQUEST = 400;

/**
 * `refused`, for calls that set a password: a 400 naming a policy rule says which rule, so the
 * visitor learns what to change instead of reading "something is not right".
 */
const refusedPassword = (result: ExplainedResult<unknown>): AuthFormState => {
  if (result.ok) {
    return { status: 'idle' };
  }
  const rule = result.status === BAD_REQUEST ? passwordPolicyErrorOf(result.message) : null;
  return fail(rule ?? authErrorFor(result.status));
};

const goTo = async (path: string): Promise<never> =>
  redirect({ href: path, locale: await getLocale() });

/**
 * Turns a login answer into cookies. Staff accounts are refused here (and their fresh session
 * revoked): staff sign in at /admin, where MFA enrolment lives.
 */
const startSession = async (res: LoginResponse): Promise<AuthFormState | 'signedIn'> => {
  const jar = await cookies();
  if (res.kind === 'mfa' && res.mfaToken) {
    writeMfaChallenge(jar, res.mfaToken);
    return { status: 'mfa' };
  }
  const tokens = sessionTokensOf(res);
  if (res.kind !== 'session' || !tokens) {
    return fail('staffPortal');
  }
  if (res.portal === 'ADMIN') {
    const caller = await callerFromAction();
    await authApi.logout({ ...caller, accessToken: tokens.accessToken });
    return fail('staffPortal');
  }
  writeSession(jar, tokens);
  await mergeGuestCart(jar, { ...(await callerFromAction()), accessToken: tokens.accessToken });
  return 'signedIn';
};

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = field(form, 'email');
  const password = secret(form, 'password');
  const invalid = checkEmail(email) ?? (password ? null : 'credentials');
  if (invalid) {
    return fail(invalid);
  }
  const result = await authApi.login(await callerFromAction(), email, password);
  if (!result.ok) {
    return refused(result);
  }
  const outcome = await startSession(result.data);
  return outcome === 'signedIn' ? goTo(safeNextPath(form.get('next'))) : outcome;
}

export async function verifyMfaAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const mfaToken = (await cookies()).get(SESSION_COOKIE.mfa)?.value;
  if (!mfaToken) {
    return fail('mfaExpired');
  }
  const recoveryCode = field(form, 'recoveryCode');
  const code = field(form, 'code');
  if (!recoveryCode && checkCode(code)) {
    return { status: 'error', error: 'codeInvalid' };
  }
  const proof = recoveryCode ? { recoveryCode } : { code };
  const result = await authApi.loginMfa(await callerFromAction(), mfaToken, proof);
  if (!result.ok) {
    return result.status === 401 ? { status: 'error', error: 'code' } : refused(result);
  }
  const outcome = await startSession(result.data);
  return outcome === 'signedIn' ? goTo(safeNextPath(form.get('next'))) : outcome;
}

export async function registerAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const fullName = field(form, 'fullName');
  const email = field(form, 'email');
  const invalid =
    (fullName && fullName.length <= FULL_NAME_MAX_LENGTH ? null : 'nameMissing') ??
    checkEmail(email) ??
    checkNewPassword(secret(form, 'password'), secret(form, 'confirm'));
  if (invalid) {
    return fail(invalid);
  }
  const preferredLanguage = (await getLocale()) === 'en' ? 'EN' : 'BN';
  const result = await authApi.register(await callerFromAction(), {
    email,
    password: secret(form, 'password'),
    fullName,
    preferredLanguage,
  });
  return result.ok ? { status: 'sent', email } : refusedPassword(result);
}

export async function verifyEmailAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const token = field(form, 'token');
  const email = field(form, 'email');
  const code = field(form, 'code');
  if (!token) {
    const invalid = checkEmail(email) ?? checkCode(code);
    if (invalid) {
      return fail(invalid);
    }
  }
  const result = await authApi.verifyEmail(
    await callerFromAction(),
    token ? { token } : { email, code },
  );
  return result.ok ? { status: 'done' } : refused(result);
}

export async function resendVerificationAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = field(form, 'email');
  const invalid = checkEmail(email);
  if (invalid) {
    return fail(invalid);
  }
  const result = await authApi.resendVerification(await callerFromAction(), email);
  return result.ok ? { status: 'sent', email } : refused(result);
}

export async function forgotPasswordAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = field(form, 'email');
  const invalid = checkEmail(email);
  if (invalid) {
    return fail(invalid);
  }
  const result = await authApi.forgotPassword(await callerFromAction(), email);
  return result.ok ? { status: 'sent', email } : refused(result);
}

export async function resetPasswordAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const token = field(form, 'token');
  const email = field(form, 'email');
  const code = field(form, 'code');
  const newPassword = secret(form, 'password');
  const invalid =
    (token ? null : (checkEmail(email) ?? checkCode(code))) ??
    checkNewPassword(newPassword, secret(form, 'confirm'));
  if (invalid) {
    return fail(invalid);
  }
  const proof = token ? { token } : { email, code };
  const result = await authApi.resetPassword(await callerFromAction(), { ...proof, newPassword });
  return result.ok ? { status: 'done' } : refusedPassword(result);
}

/** Revokes the session at the API (best effort), clears the cookies, and goes home. */
export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const accessToken = jar.get(SESSION_COOKIE.access)?.value;
  if (accessToken) {
    await authApi.logout({ ...(await callerFromAction()), accessToken });
  }
  clearSession(jar);
  await goTo('/');
}

'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';

import { redirect } from '../../i18n/navigation';
import { clearSession } from '../auth/cookies';
import { ROUTES } from '../routes';
import { accountCaller } from './caller';
import {
  checkPasswordChange,
  type PasswordChangeError,
  passwordChangeErrorOf,
} from './passwordChange';
import { securityApi } from './security';

export type PasswordChangeState =
  | { status: 'idle' }
  | { status: 'changed'; at: number }
  | { status: 'error'; error: PasswordChangeError; at: number };

/** Message keys under `security.devices.errors`. */
export type DeviceActionError = 'signedOut' | 'failed';

export type DeviceActionState =
  { status: 'idle' } | { status: 'error'; error: DeviceActionError; at: number };

const NOT_FOUND = 404;
const UNAUTHORIZED = 401;

/** Passwords are never trimmed: a trailing space is a character the user chose. */
const secret = (form: FormData, name: string): string => String(form.get(name) ?? '');

const passwordError = (error: PasswordChangeError): PasswordChangeState => ({
  status: 'error',
  error,
  at: Date.now(),
});

const deviceError = (error: DeviceActionError): DeviceActionState => ({
  status: 'error',
  error,
  at: Date.now(),
});

const toSignIn = async (): Promise<never> =>
  redirect({
    href: { pathname: ROUTES.signIn, query: { next: ROUTES.security } },
    locale: await getLocale(),
  });

/**
 * Changes the password after checking the current one. The API ends every other session and
 * keeps this one, so the device list is drawn again without them.
 */
export async function changePasswordAction(
  _prev: PasswordChangeState,
  form: FormData,
): Promise<PasswordChangeState> {
  const input = {
    currentPassword: secret(form, 'currentPassword'),
    newPassword: secret(form, 'newPassword'),
    confirmPassword: secret(form, 'confirmPassword'),
  };
  const invalid = checkPasswordChange(input);
  if (invalid) {
    return passwordError(invalid);
  }
  const caller = await accountCaller();
  if (!caller) {
    return passwordError('signedOut');
  }
  const result = await securityApi.changePassword(caller, {
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  });
  if (!result.ok) {
    return passwordError(passwordChangeErrorOf(result.status, result.message));
  }
  refresh();
  return { status: 'changed', at: Date.now() };
}

/** Signs one other device out. One that has already gone counts as done. */
export async function endSessionAction(
  _prev: DeviceActionState,
  form: FormData,
): Promise<DeviceActionState> {
  const caller = await accountCaller();
  if (!caller) {
    return deviceError('signedOut');
  }
  const id = String(form.get('id') ?? '').trim();
  const result = id ? await securityApi.endSession(caller, id) : null;
  if (result && !result.ok && result.status !== NOT_FOUND) {
    return deviceError(result.status === UNAUTHORIZED ? 'signedOut' : 'failed');
  }
  refresh();
  return { status: 'idle' };
}

/**
 * Signs every device out, this one included, then sends the visitor to sign in again. A 401
 * means this session had already ended, which leaves the same outcome. Used as a form action
 * through `useActionState`, which passes the previous state and the form; neither is needed.
 */
export async function endAllSessionsAction(): Promise<DeviceActionState> {
  const caller = await accountCaller();
  if (!caller) {
    return deviceError('signedOut');
  }
  const result = await securityApi.endAllSessions(caller);
  if (!result.ok && result.status !== UNAUTHORIZED) {
    return deviceError('failed');
  }
  clearSession(await cookies());
  return toSignIn();
}

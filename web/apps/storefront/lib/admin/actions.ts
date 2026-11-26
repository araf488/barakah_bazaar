'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { authApi, type LoginResponse, sessionTokensOf, UNREACHABLE_STATUS } from '../auth/api';
import { callerFromAction } from '../auth/caller';
import { passwordPolicyErrorOf } from '../auth/passwordPolicy';
import { checkEmail, checkNewPassword } from '../auth/rules';
import { staffApi } from './api';
import {
  clearStaffChallenge,
  clearStaffSession,
  readStaffChallenge,
  STAFF_COOKIE,
  writeStaffChallenge,
  writeStaffSession,
} from './cookies';
import type { InvitationError, SignInError } from './copy';
import { ADMIN_ROUTES, NEXT_PARAM, safeAdminNext } from './routes';
import { checkStaffCode, type CodeKind } from './rules';

export type SignInState = { status: 'idle' } | { status: 'error'; error: SignInError; at: number };

export type MfaSetupState =
  | { status: 'idle' }
  | { status: 'ready'; secret: string; otpauthUri: string }
  | { status: 'enabled'; recoveryCodes: string[] }
  | { status: 'error'; error: SignInError; at: number; secret?: string; otpauthUri?: string };

export type InvitationState =
  | { status: 'idle' }
  | { status: 'accepted' }
  | { status: 'error'; error: InvitationError; at: number };

const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;
const STATUS_GONE = 410;
const STATUS_TOO_MANY = 429;

const field = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

/** Passwords are never trimmed: a trailing space is a character the user chose. */
const secret = (form: FormData, name: string): string => String(form.get(name) ?? '');

const signInError = (error: SignInError): SignInState => ({
  status: 'error',
  error,
  at: Date.now(),
});

/** A refused sign-in call as the error the form shows. */
const signInErrorOf = (status: number): SignInError => {
  switch (status) {
    case STATUS_UNAUTHORIZED:
      return 'credentials';
    case STATUS_FORBIDDEN:
      return 'blocked';
    case STATUS_TOO_MANY:
      return 'tooMany';
    default:
      return 'unavailable';
  }
};

/** The sign-in path for a second step, carrying where the staff member was going. */
const stepPath = (path: string, next: string): string =>
  next === ADMIN_ROUTES.home ? path : `${path}?${new URLSearchParams({ [NEXT_PARAM]: next })}`;

/**
 * Turns a login answer into what happens next. A customer's session is ended at once: the
 * portal is for staff, and a customer token must never sit in a staff cookie.
 */
const finishSignIn = async (res: LoginResponse, next: string): Promise<SignInState> => {
  const jar = await cookies();
  if (res.kind === 'mfa' && res.mfaToken) {
    writeStaffChallenge(jar, { kind: 'mfa', token: res.mfaToken });
    redirect(stepPath(ADMIN_ROUTES.verify, next));
  }
  if (res.kind === 'enrolment' && res.enrolmentToken) {
    writeStaffChallenge(jar, { kind: 'enrolment', token: res.enrolmentToken });
    redirect(ADMIN_ROUTES.setup);
  }
  const tokens = sessionTokensOf(res);
  if (!tokens) {
    return signInError('unavailable');
  }
  if (res.portal !== 'ADMIN') {
    await authApi.logout({ ...(await callerFromAction()), accessToken: tokens.accessToken });
    return signInError('notStaff');
  }
  writeStaffSession(jar, tokens);
  redirect(next);
};

export async function staffSignInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = field(form, 'email');
  const password = secret(form, 'password');
  if (checkEmail(email)) {
    return signInError('emailInvalid');
  }
  if (!password) {
    return signInError('passwordMissing');
  }
  const result = await authApi.login(await callerFromAction(), email, password);
  if (!result.ok) {
    return signInError(signInErrorOf(result.status));
  }
  return finishSignIn(result.data, safeAdminNext(form.get(NEXT_PARAM)));
}

/** The second step: a code from the authenticator, or one of the recovery codes. */
export async function verifyStaffCodeAction(
  _prev: SignInState,
  form: FormData,
): Promise<SignInState> {
  const mfaToken = readStaffChallenge((await cookies()).get(STAFF_COOKIE.challenge)?.value, 'mfa');
  if (!mfaToken) {
    return signInError('expired');
  }
  const kind: CodeKind = field(form, 'method') === 'recovery' ? 'recovery' : 'code';
  const raw = field(form, kind === 'recovery' ? 'recoveryCode' : 'code');
  // Recovery codes are lowercase hex; a code copied with spaces, dashes or capitals still counts.
  const value = kind === 'recovery' ? raw.replace(/[\s-]/g, '').toLowerCase() : raw;
  const invalid = checkStaffCode(kind, value);
  if (invalid) {
    return signInError(invalid);
  }
  const proof = kind === 'recovery' ? { recoveryCode: value } : { code: value };
  const result = await authApi.loginMfa(await callerFromAction(), mfaToken, proof);
  if (!result.ok) {
    return signInError(mfaErrorOf(result.status));
  }
  return finishSignIn(result.data, safeAdminNext(form.get(NEXT_PARAM)));
}

const mfaErrorOf = (status: number): SignInError => {
  if (status === STATUS_UNAUTHORIZED) {
    return 'code';
  }
  return status === STATUS_TOO_MANY ? 'locked' : signInErrorOf(status);
};

const setupError = (error: SignInError, shown?: { secret: string; otpauthUri: string }) =>
  ({ status: 'error', error, at: Date.now(), ...shown }) as const satisfies MfaSetupState;

/** A refused setup call. 409: the account finished enrolment already, its secret is kept. */
const setupErrorOf = (status: number): SignInError => {
  if (status === STATUS_CONFLICT) {
    return 'alreadyEnabled';
  }
  return status === STATUS_UNAUTHORIZED ? 'expired' : signInErrorOf(status);
};

/** A refused confirmation: a wrong first code is 400 or 401; 409 means enrolment already finished. */
const enableErrorOf = (status: number): SignInError => {
  if (status === STATUS_BAD_REQUEST) {
    return 'code';
  }
  return status === STATUS_CONFLICT ? 'alreadyEnabled' : mfaErrorOf(status);
};

const enrolmentToken = async (): Promise<string | null> =>
  readStaffChallenge((await cookies()).get(STAFF_COOKIE.challenge)?.value, 'enrolment');

/** Fetches the authenticator key for a staff member setting up two-step sign-in. */
export async function startMfaSetupAction(): Promise<MfaSetupState> {
  const token = await enrolmentToken();
  if (!token) {
    return setupError('expired');
  }
  const result = await staffApi.mfaSetup(await callerFromAction(), token);
  if (!result.ok) {
    return setupError(setupErrorOf(result.status));
  }
  return { status: 'ready', secret: result.data.secret, otpauthUri: result.data.otpauthUri };
}

/**
 * Confirms setup with a first code and hands back the recovery codes, shown once. The API issues
 * no session here: the staff member signs in again, this time with a code.
 */
export async function enableMfaAction(prev: MfaSetupState, form: FormData): Promise<MfaSetupState> {
  const shown =
    prev.status === 'ready' || (prev.status === 'error' && prev.secret && prev.otpauthUri)
      ? { secret: prev.secret ?? '', otpauthUri: prev.otpauthUri ?? '' }
      : undefined;
  const token = await enrolmentToken();
  if (!token) {
    return setupError('expired');
  }
  const code = field(form, 'code');
  const invalid = checkStaffCode('code', code);
  if (invalid) {
    return setupError(invalid, shown);
  }
  const result = await staffApi.mfaEnable(await callerFromAction(), token, code);
  if (!result.ok) {
    return setupError(enableErrorOf(result.status), shown);
  }
  // Ended at once so the setup page cannot fetch, and the API could not issue, a second key that
  // would replace the one now in the app. The page keeps showing the recovery codes regardless.
  clearStaffChallenge(await cookies());
  return { status: 'enabled', recoveryCodes: result.data.recoveryCodes };
}

/** Ends the staff session at the API (best effort), clears the staff cookies, and goes to sign-in. */
export async function staffSignOutAction(): Promise<void> {
  const jar = await cookies();
  const accessToken = jar.get(STAFF_COOKIE.access)?.value;
  if (accessToken) {
    await authApi.logout({ ...(await callerFromAction()), accessToken });
  }
  clearStaffSession(jar);
  redirect(ADMIN_ROUTES.signIn);
}

const invitationError = (error: InvitationError): InvitationState => ({
  status: 'error',
  error,
  at: Date.now(),
});

/** A refused acceptance as the error the form shows. */
const invitationErrorOf = (status: number, message: string | null): InvitationError => {
  switch (status) {
    case STATUS_BAD_REQUEST:
      return passwordPolicyErrorOf(message) ?? 'formInvalid';
    case STATUS_NOT_FOUND:
      return 'invalid';
    case STATUS_GONE:
      return 'expired';
    case STATUS_CONFLICT:
      return 'accountExists';
    case STATUS_TOO_MANY:
      return 'tooMany';
    case UNREACHABLE_STATUS:
    default:
      return 'unavailable';
  }
};

/** Creates the invited staff account: a name and a password. Signing in comes next. */
export async function acceptInvitationAction(
  _prev: InvitationState,
  form: FormData,
): Promise<InvitationState> {
  const token = field(form, 'token');
  const fullName = field(form, 'fullName');
  const password = secret(form, 'password');
  if (!token) {
    return invitationError('invalid');
  }
  if (!fullName) {
    return invitationError('nameMissing');
  }
  const invalid = checkNewPassword(password, secret(form, 'confirm'));
  if (invalid) {
    return invitationError(invalid as InvitationError);
  }
  const result = await staffApi.acceptInvitation(await callerFromAction(), {
    token,
    password,
    fullName,
  });
  return result.ok
    ? { status: 'accepted' }
    : invitationError(invitationErrorOf(result.status, result.message));
}

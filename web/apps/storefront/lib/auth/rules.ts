/** Mirrors `AuthConstants` in the API (src/modules/auth/auth.constants.ts). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const FULL_NAME_MAX_LENGTH = 120;

/** The API's one-time codes are six digits. */
export const ONE_TIME_CODE_PATTERN = /^\d{6}$/;

/** Close enough to the API's `@IsEmail` to catch typos before a round trip; the API decides. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldError =
  | 'emailInvalid'
  | 'passwordShort'
  | 'passwordLong'
  | 'passwordMismatch'
  | 'nameMissing'
  | 'codeInvalid';

export const checkEmail = (email: string): FieldError | null =>
  EMAIL_PATTERN.test(email) ? null : 'emailInvalid';

export const checkNewPassword = (password: string, confirm: string): FieldError | null => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return 'passwordShort';
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return 'passwordLong';
  }
  return password === confirm ? null : 'passwordMismatch';
};

export const checkCode = (code: string): FieldError | null =>
  ONE_TIME_CODE_PATTERN.test(code) ? null : 'codeInvalid';

const LOCALE_PREFIX = /^\/(bn|en)(?=\/|$)/;

/**
 * Where to go after signing in: a same-site path from the `next` field, without its locale
 * (the redirect adds the current one). Anything else, including `//evil.example`, goes home.
 */
export const safeNextPath = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return '/';
  }
  return value.replace(LOCALE_PREFIX, '') || '/';
};

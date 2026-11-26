import type { SignInError } from './copy';

/** Digits in an authenticator code (`AuthConstants`: 6-digit TOTP). */
export const STAFF_CODE_LENGTH = 6;
export const STAFF_CODE_PATTERN = /^\d{6}$/;

/** Recovery codes are 20 hex characters (10 random bytes); the API decides, this catches typos. */
export const RECOVERY_CODE_LENGTH = 20;
export const RECOVERY_CODE_PATTERN = /^[0-9a-f]{20}$/;

export type CodeKind = 'code' | 'recovery';

/** The first problem with a second-step code, or `null` to send it. */
export const checkStaffCode = (kind: CodeKind, value: string): SignInError | null => {
  if (kind === 'recovery') {
    return RECOVERY_CODE_PATTERN.test(value) ? null : 'recoveryFormat';
  }
  return STAFF_CODE_PATTERN.test(value) ? null : 'codeFormat';
};

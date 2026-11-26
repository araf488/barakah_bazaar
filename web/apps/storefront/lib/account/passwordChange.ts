import { type PasswordPolicyError, passwordPolicyErrorOf } from '../auth/passwordPolicy';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/rules';

// What the change-password form checks before a round trip, and how it reads the API's refusals.

/** Message keys under `security.password.errors`. */
export type PasswordChangeError =
  | PasswordPolicyError
  | 'currentMissing'
  | 'passwordMismatch'
  | 'passwordSame'
  | 'currentWrong'
  | 'invalid'
  | 'signedOut'
  | 'tooMany'
  | 'failed';

/** `AuthMessages.InvalidCredentials`: the current password was wrong, the session is fine. */
const WRONG_CURRENT_PASSWORD = 'Those sign-in details are not correct.';

const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const TOO_MANY_REQUESTS = 429;

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** The first problem the form can see by itself, or `null` to send it. */
export const checkPasswordChange = (input: PasswordChangeInput): PasswordChangeError | null => {
  if (!input.currentPassword) {
    return 'currentMissing';
  }
  if (input.newPassword.length < PASSWORD_MIN_LENGTH) {
    return 'passwordShort';
  }
  if (input.newPassword.length > PASSWORD_MAX_LENGTH) {
    return 'passwordLong';
  }
  if (input.newPassword === input.currentPassword) {
    return 'passwordSame';
  }
  return input.newPassword === input.confirmPassword ? null : 'passwordMismatch';
};

/**
 * An API refusal as a form error. A 401 is either the wrong current password or a session that
 * has ended; only the message tells them apart.
 */
export const passwordChangeErrorOf = (
  status: number,
  message: string | null,
): PasswordChangeError => {
  if (status === UNAUTHORIZED) {
    return message === WRONG_CURRENT_PASSWORD ? 'currentWrong' : 'signedOut';
  }
  if (status === BAD_REQUEST) {
    return passwordPolicyErrorOf(message) ?? 'invalid';
  }
  return status === TOO_MANY_REQUESTS ? 'tooMany' : 'failed';
};

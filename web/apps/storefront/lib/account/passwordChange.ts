import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/rules';

// What the change-password form checks before a round trip, and how it reads the API's refusals.

/** Message keys under `security.password.errors`. */
export type PasswordChangeError =
  | 'currentMissing'
  | 'passwordShort'
  | 'passwordLong'
  | 'passwordMismatch'
  | 'passwordSame'
  | 'passwordCommon'
  | 'passwordIdentity'
  | 'passwordShopName'
  | 'passwordDistinct'
  | 'passwordSequential'
  | 'passwordClasses'
  | 'currentWrong'
  | 'invalid'
  | 'signedOut'
  | 'tooMany'
  | 'failed';

/**
 * The API's password-policy refusals (`AuthMessages` in src/modules/auth/auth.constants.ts,
 * which says changing one is an API change). Matched whole, so the form can name the rule the
 * password broke, in the reader's language.
 */
const POLICY_MESSAGES: Readonly<Record<string, PasswordChangeError>> = {
  'Your password must be at least 12 characters.': 'passwordShort',
  'Your password must be 128 characters or fewer.': 'passwordLong',
  'That password is too common. Please choose a different one.': 'passwordCommon',
  'Your password must not contain your name or email address.': 'passwordIdentity',
  'Your password must not contain the name of this shop.': 'passwordShopName',
  'Your password must use at least 6 different characters.': 'passwordDistinct',
  'Your password must not contain a long run of sequential characters.': 'passwordSequential',
  'Your password must include an uppercase letter, a lowercase letter, a number and a special character.':
    'passwordClasses',
};

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
    return (message && POLICY_MESSAGES[message]) || 'invalid';
  }
  return status === TOO_MANY_REQUESTS ? 'tooMany' : 'failed';
};

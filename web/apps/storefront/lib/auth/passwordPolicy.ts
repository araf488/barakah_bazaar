// How the forms that set a password (register, reset, change) read the API's policy refusals.

/** Message keys for each password-policy rule; every password form's error namespace has them. */
export const PASSWORD_POLICY_ERRORS = [
  'passwordShort',
  'passwordLong',
  'passwordCommon',
  'passwordIdentity',
  'passwordShopName',
  'passwordDistinct',
  'passwordSequential',
  'passwordClasses',
] as const;

export type PasswordPolicyError = (typeof PASSWORD_POLICY_ERRORS)[number];

/**
 * The API's password-policy refusals (`AuthMessages` in src/modules/auth/auth.constants.ts,
 * which says changing one is an API change). Matched whole, so a form can name the rule the
 * password broke, in the reader's language.
 */
const POLICY_MESSAGES: Readonly<Record<string, PasswordPolicyError>> = {
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

/**
 * The policy rule a 400's message names, or `null` when it names none (a malformed request).
 * Own keys only, so a message such as `constructor` cannot resolve to `Object.prototype`.
 */
export const passwordPolicyErrorOf = (message: string | null): PasswordPolicyError | null => {
  if (!message || !Object.hasOwn(POLICY_MESSAGES, message)) {
    return null;
  }
  return POLICY_MESSAGES[message] ?? null;
};

import { describe, expect, it } from 'vitest';

import { PASSWORD_POLICY_ERRORS, passwordPolicyErrorOf } from '../passwordPolicy';

describe('passwordPolicyErrorOf', () => {
  it.each([
    ['Your password must be at least 12 characters.', 'passwordShort'],
    ['Your password must be 128 characters or fewer.', 'passwordLong'],
    ['That password is too common. Please choose a different one.', 'passwordCommon'],
    ['Your password must not contain your name or email address.', 'passwordIdentity'],
    ['Your password must not contain the name of this shop.', 'passwordShopName'],
    ['Your password must use at least 6 different characters.', 'passwordDistinct'],
    ['Your password must not contain a long run of sequential characters.', 'passwordSequential'],
    [
      'Your password must include an uppercase letter, a lowercase letter, a number and a special character.',
      'passwordClasses',
    ],
  ])('names the rule in "%s"', (message, error) => {
    expect(passwordPolicyErrorOf(message)).toBe(error);
  });

  it('names no rule for a message outside the policy, or none at all', () => {
    expect(passwordPolicyErrorOf('password must be a string')).toBeNull();
    expect(passwordPolicyErrorOf('')).toBeNull();
    expect(passwordPolicyErrorOf(null)).toBeNull();
  });

  it('ignores inherited keys, so a message such as "constructor" names no rule', () => {
    expect(passwordPolicyErrorOf('constructor')).toBeNull();
    expect(passwordPolicyErrorOf('toString')).toBeNull();
  });

  it('lists every rule it can name, so each form marks the password field for all of them', () => {
    expect([...PASSWORD_POLICY_ERRORS].sort()).toEqual(
      [
        'passwordClasses',
        'passwordCommon',
        'passwordDistinct',
        'passwordIdentity',
        'passwordLong',
        'passwordSequential',
        'passwordShopName',
        'passwordShort',
      ].sort(),
    );
  });
});

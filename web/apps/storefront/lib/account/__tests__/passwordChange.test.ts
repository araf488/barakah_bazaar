import { describe, expect, it } from 'vitest';

import { checkPasswordChange, passwordChangeErrorOf } from '../passwordChange';

const VALID = {
  currentPassword: 'Old-password-1',
  newPassword: 'Mango-season-2026',
  confirmPassword: 'Mango-season-2026',
};

describe('checkPasswordChange', () => {
  it('lets a complete change through', () => {
    expect(checkPasswordChange(VALID)).toBeNull();
  });

  it('asks for the current password first', () => {
    expect(checkPasswordChange({ ...VALID, currentPassword: '' })).toBe('currentMissing');
  });

  it('refuses a new password under 12 characters', () => {
    expect(
      checkPasswordChange({ ...VALID, newPassword: 'Short-1', confirmPassword: 'Short-1' }),
    ).toBe('passwordShort');
  });

  it('refuses a new password over 128 characters', () => {
    const long = 'a'.repeat(129);
    expect(checkPasswordChange({ ...VALID, newPassword: long, confirmPassword: long })).toBe(
      'passwordLong',
    );
  });

  it('refuses the same password again', () => {
    expect(
      checkPasswordChange({
        currentPassword: VALID.newPassword,
        newPassword: VALID.newPassword,
        confirmPassword: VALID.newPassword,
      }),
    ).toBe('passwordSame');
  });

  it('refuses a confirmation that does not match', () => {
    expect(checkPasswordChange({ ...VALID, confirmPassword: 'Mango-season-2025' })).toBe(
      'passwordMismatch',
    );
  });
});

describe('passwordChangeErrorOf', () => {
  it('reads a wrong current password from the 401 message', () => {
    expect(passwordChangeErrorOf(401, 'Those sign-in details are not correct.')).toBe(
      'currentWrong',
    );
  });

  it('reads any other 401 as an ended session', () => {
    expect(passwordChangeErrorOf(401, 'Missing access token.')).toBe('signedOut');
    expect(passwordChangeErrorOf(401, null)).toBe('signedOut');
  });

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
  ])('names the policy rule in "%s"', (message, error) => {
    expect(passwordChangeErrorOf(400, message)).toBe(error);
  });

  it('reads an unknown 400 as an invalid form', () => {
    expect(passwordChangeErrorOf(400, 'newPassword must be a string')).toBe('invalid');
    expect(passwordChangeErrorOf(400, null)).toBe('invalid');
  });

  it('reads 429 as too many attempts', () => {
    expect(passwordChangeErrorOf(429, null)).toBe('tooMany');
  });

  it('reads anything else, an unreachable API included, as a failure', () => {
    expect(passwordChangeErrorOf(503, null)).toBe('failed');
    expect(passwordChangeErrorOf(0, null)).toBe('failed');
  });
});

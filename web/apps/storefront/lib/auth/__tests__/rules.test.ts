import { describe, expect, it } from 'vitest';

import { checkCode, checkEmail, checkNewPassword, safeNextPath } from '../rules';

describe('auth form rules', () => {
  it('accepts a plausible email and rejects a typo', () => {
    expect(checkEmail('tahmina@example.com')).toBeNull();
    expect(checkEmail('tahmina@example')).toBe('emailInvalid');
  });

  it('holds new passwords to the API’s 12 to 128 characters, and to the confirmation', () => {
    expect(checkNewPassword('short', 'short')).toBe('passwordShort');
    expect(checkNewPassword('x'.repeat(129), 'x'.repeat(129))).toBe('passwordLong');
    expect(checkNewPassword('long enough pw', 'long enough pX')).toBe('passwordMismatch');
    expect(checkNewPassword('long enough pw', 'long enough pw')).toBeNull();
  });

  it('wants exactly six digits for a one-time code', () => {
    expect(checkCode('123456')).toBeNull();
    expect(checkCode('12345')).toBe('codeInvalid');
    expect(checkCode('12345a')).toBe('codeInvalid');
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/p/ajwa-dates', '/p/ajwa-dates'],
    ['/bn/p/ajwa-dates', '/p/ajwa-dates'],
    ['/en', '/'],
    ['//evil.example/x', '/'],
    ['https://evil.example', '/'],
    ['/\\evil.example', '/'],
    [null, '/'],
  ])('sends %s to %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

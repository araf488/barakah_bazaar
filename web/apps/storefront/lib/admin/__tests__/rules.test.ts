import { describe, expect, it } from 'vitest';

import { checkStaffCode } from '../rules';

describe('checkStaffCode', () => {
  it('takes six digits from the authenticator', () => {
    expect(checkStaffCode('code', '123456')).toBeNull();
  });

  it.each(['12345', '1234567', '12 456', 'abcdef', ''])('refuses the code %j', (code) => {
    expect(checkStaffCode('code', code)).toBe('codeFormat');
  });

  it('takes twenty lowercase hex characters as a recovery code', () => {
    expect(checkStaffCode('recovery', '0123456789abcdef0123')).toBeNull();
  });

  it.each(['0123456789abcdef012', '0123456789ABCDEF0123', 'g123456789abcdef0123'])(
    'refuses the recovery code %j',
    (code) => {
      expect(checkStaffCode('recovery', code)).toBe('recoveryFormat');
    },
  );
});

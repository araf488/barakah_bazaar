import { PasswordPolicy } from './password-policy';

const context = { email: 'rahim.uddin@example.com', fullName: 'Rahim Uddin' };

describe('PasswordPolicy', () => {
  let policy: PasswordPolicy;

  beforeEach(() => {
    policy = new PasswordPolicy();
  });

  it('accepts a strong passphrase', () => {
    expect(policy.check('marbled kingfisher 41', context)).toBeNull();
  });

  it('rejects a password on the bundled list', () => {
    expect(policy.check('passwordpassword', context)).toBe(
      'That password is too common. Please choose a different one.',
    );
  });

  it('matches the list regardless of casing', () => {
    expect(policy.check('PassWordPassWord', context)).not.toBeNull();
  });

  it('rejects a password containing the email local-part', () => {
    expect(policy.check('rahim.uddin-2026!', context)).toBe(
      'Your password must not contain your name or email address.',
    );
  });

  it('rejects a password containing the full name, ignoring case', () => {
    expect(policy.check('xx RAHIM UDDIN xx', context)).not.toBeNull();
  });

  it('rejects a password containing the shop name', () => {
    expect(policy.check('barakah-shopping-01', context)).toBe(
      'Your password must not contain the name of this shop.',
    );
  });

  it('rejects a single repeated character', () => {
    expect(policy.check('aaaaaaaaaaaa', context)).toBe(
      'Your password must use at least 6 different characters.',
    );
  });

  it('rejects a long ascending run', () => {
    expect(policy.check('abcdefghijkl', context)).toBe(
      'Your password must not contain a long run of sequential characters.',
    );
  });

  it('rejects a long descending run', () => {
    expect(policy.check('zyxwvutsrqpo', context)).not.toBeNull();
  });

  it('rejects a long digit run', () => {
    expect(policy.check('mango1234567', context)).not.toBeNull();
  });

  it('rejects fewer than six distinct characters', () => {
    expect(policy.check('ababababbaba', context)).toBe(
      'Your password must use at least 6 different characters.',
    );
  });

  it('tolerates a missing full name', () => {
    expect(policy.check('marbled kingfisher 41', { email: 'a@b.com' })).toBeNull();
  });

  it('does not reject a short name fragment that would match almost anything', () => {
    // A two-letter name must not make every password containing those letters invalid.
    expect(policy.check('marbled kingfisher 41', { email: 'ma@b.com', fullName: 'Ma' })).toBeNull();
  });

  describe('length', () => {
    it('rejects a password one character below the minimum', () => {
      expect(policy.check('marbled kin', context)).toBe(
        'Your password must be at least 12 characters.',
      );
    });

    it('accepts a password of exactly the minimum length', () => {
      expect(policy.check('marbled kin1', context)).toBeNull();
    });

    it('reports length before any other reason', () => {
      // 'admin' is on the bundled list, but its problem at this length is that it is short.
      expect(policy.check('admin', context)).toBe('Your password must be at least 12 characters.');
    });

    it('accepts a passphrase of exactly the maximum length', () => {
      const password = 'marbled kingfisher 41 '.repeat(6).slice(0, 128);

      expect(password).toHaveLength(128);
      expect(policy.check(password, context)).toBeNull();
    });

    it('rejects a password one character above the maximum', () => {
      const password = 'marbled kingfisher 41 '.repeat(6).slice(0, 129);

      expect(policy.check(password, context)).toBe(
        'Your password must be 128 characters or fewer.',
      );
    });

    it('counts characters the way the person typing them does, not UTF-16 units', () => {
      // 11 characters but 12 UTF-16 code units: the emoji is a surrogate pair.
      expect('mango\u{1F347} tree').toHaveLength(12);

      expect(policy.check('mango\u{1F347} tree', context)).toBe(
        'Your password must be at least 12 characters.',
      );
      expect(policy.check('mango\u{1F347} trees', context)).toBeNull();
    });
  });
});

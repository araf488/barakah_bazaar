import { PasswordPolicy } from './password-policy';

const context = { email: 'rahim.uddin@example.com', fullName: 'Rahim Uddin' };

describe('PasswordPolicy', () => {
  let policy: PasswordPolicy;

  beforeEach(() => {
    policy = new PasswordPolicy();
  });

  it('accepts a strong passphrase', () => {
    expect(policy.check('Marbled Kingfisher 41!', context)).toBeNull();
  });

  it('rejects a password on the bundled list', () => {
    expect(policy.check('passwordpassword', context)).toBe(
      'That password is too common. Please choose a different one.',
    );
  });

  // The denylist is only worth having if it is actually the ~100k corpus §4.5 describes. For a
  // long time it was a 42-line hand-written seed, and every test above still passed, because
  // each asserted a password that was inside those 42. These three come from deep in the real
  // corpus — they are absent from the seed, so this fails against it and passes only against a
  // list of the intended size.
  it.each(['international', 'leavemealone', 'administrator'])(
    'rejects %s, which only a real corpus contains',
    (password) => {
      expect(policy.check(password, context)).toBe(
        'That password is too common. Please choose a different one.',
      );
    },
  );

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

  // These two deliberately avoid `aaaaaaaaaaaa` and `abcdefghijkl`: both are in the bundled
  // denylist, which is checked first, so they proved the denylist rather than the rule named
  // in the test. Picked from letters the list does not carry, so the contextual rule is what
  // actually fires.
  it('rejects a single repeated character', () => {
    expect(policy.check('cccccccccccc', context)).toBe(
      'Your password must use at least 6 different characters.',
    );
  });

  it('rejects a long ascending run', () => {
    expect(policy.check('defghijklmno', context)).toBe(
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
    expect(policy.check('Marbled Kingfisher 41!', { email: 'a@b.com' })).toBeNull();
  });

  it('does not reject a short name fragment that would match almost anything', () => {
    // A two-letter name must not make every password containing those letters invalid.
    expect(
      policy.check('Marbled Kingfisher 41!', { email: 'ma@b.com', fullName: 'Ma' }),
    ).toBeNull();
  });

  describe('length', () => {
    it('rejects a password one character below the minimum', () => {
      expect(policy.check('marbled kin', context)).toBe(
        'Your password must be at least 12 characters.',
      );
    });

    it('accepts a password of exactly the minimum length', () => {
      // Exactly 12, and carrying all four classes so length is the only thing under test.
      expect('Marbled~Kin1').toHaveLength(12);
      expect(policy.check('Marbled~Kin1', context)).toBeNull();
    });

    it('reports length before any other reason', () => {
      // 'admin' is on the bundled list, but its problem at this length is that it is short.
      expect(policy.check('admin', context)).toBe('Your password must be at least 12 characters.');
    });

    it('accepts a passphrase of exactly the maximum length', () => {
      const password = `Marbled Kingfisher 41! ${'x'.repeat(128)}`.slice(0, 128);

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
      // Exactly 12 code points (13 UTF-16 units), so it still sits on the boundary the
      // surrogate pair would move if the count were wrong.
      expect([...'Mango\u{1F347} Tre1!']).toHaveLength(12);
      expect(policy.check('Mango\u{1F347} Tre1!', context)).toBeNull();
    });
  });

  // Owner's decision, 2026-09-14: a password must carry an uppercase letter, a lowercase
  // letter, a digit and a special character. Checked last, so the specific diagnoses above
  // still win over the generic one.
  describe('character classes', () => {
    const MISSING =
      'Your password must include an uppercase letter, a lowercase letter, a number and a special character.';

    it('accepts a password carrying all four classes', () => {
      expect(policy.check('Marbled Kingfisher 41!', context)).toBeNull();
    });

    it.each([
      ['no uppercase', 'marbled kingfisher 41!'],
      ['no lowercase', 'MARBLED KINGFISHER 41!'],
      ['no digit', 'Marbled Kingfisher!!'],
      ['no special character', 'Marbled Kingfisher 41'],
    ])('rejects a password with %s', (_label, password) => {
      expect(policy.check(password, context)).toBe(MISSING);
    });

    it('does not count a space as a special character', () => {
      // Otherwise a passphrase would satisfy a rule that exists to demand a symbol. The space
      // is still legal in the password — it just earns nothing here.
      expect(policy.check('Marbled Kingfisher 41', context)).toBe(MISSING);
    });

    it('counts a symbol from anywhere in the allowed set, not just the common few', () => {
      expect(policy.check('Marbled~Kingfisher41', context)).toBeNull();
    });

    it('reports length before the character classes, so the shortest fix comes first', () => {
      // 'Ab1!' is missing nothing but length; length must still be what it is told about.
      expect(policy.check('Ab1!', context)).toBe('Your password must be at least 12 characters.');
    });

    it('reports a common password as common, not as missing a class', () => {
      // 'international' fails the class rule too. The more specific diagnosis has to win, or
      // the denylist becomes invisible to anyone reading the error.
      expect(policy.check('international', context)).toBe(
        'That password is too common. Please choose a different one.',
      );
    });

    // Documents the known hole rather than hiding it: the composition rule is exactly what
    // pushes people to decorate a listed password with one symbol, and the denylist matches
    // exact strings, so the decorated form is no longer on it. If a future change starts
    // catching this, that is an improvement and this test should be updated deliberately.
    it('still accepts Password123!, which is what composition rules encourage', () => {
      expect(policy.check('Password123!', context)).toBeNull();
    });
  });
});

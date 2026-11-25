import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  let hasher: PasswordHasher;

  beforeEach(() => {
    hasher = new PasswordHasher({ costLog2: 14, blockSize: 8, parallelism: 1 });
  });

  it('round-trips a password', async () => {
    const stored = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify('correct horse battery staple', stored)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify('Correct Horse Battery Staple', stored)).resolves.toBe(false);
  });

  it('produces a different hash each time, so two users sharing a password are not obvious', async () => {
    const a = await hasher.hash('same password here');
    const b = await hasher.hash('same password here');

    expect(a).not.toEqual(b);
  });

  it('records the parameters it used, so they can be raised later', async () => {
    const stored = await hasher.hash('correct horse battery staple');

    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
  });

  it('verifies a hash written with weaker parameters than the current configuration', async () => {
    const weak = await new PasswordHasher({ costLog2: 12, blockSize: 8, parallelism: 1 }).hash(
      'x'.repeat(12),
    );

    await expect(hasher.verify('x'.repeat(12), weak)).resolves.toBe(true);
  });

  it('asks for a rehash when the stored parameters are weaker than configured', async () => {
    const weak = await new PasswordHasher({ costLog2: 12, blockSize: 8, parallelism: 1 }).hash(
      'x'.repeat(12),
    );

    expect(hasher.needsRehash(weak)).toBe(true);
  });

  it('does not ask for a rehash at the configured parameters', async () => {
    expect(hasher.needsRehash(await hasher.hash('x'.repeat(12)))).toBe(false);
  });

  it('returns false rather than throwing on a malformed stored value', async () => {
    await expect(hasher.verify('anything', 'not-a-hash')).resolves.toBe(false);
  });

  it('returns false rather than throwing on an unknown algorithm tag', async () => {
    await expect(hasher.verify('anything', 'bcrypt$10$abc$def')).resolves.toBe(false);
  });

  it('offers a dummy hash of the configured shape, for the not-found login path', () => {
    expect(PasswordHasher.DUMMY_HASH.startsWith('scrypt$')).toBe(true);
  });
});

import { randomBytes } from 'node:crypto';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { SecretCipher } from './secret-cipher';

const key = randomBytes(32).toString('base64');

describe('SecretCipher', () => {
  let cipher: SecretCipher;

  beforeEach(() => {
    cipher = new SecretCipher(key);
  });

  it('round-trips a secret', () => {
    const sealed = cipher.encrypt('JBSWY3DPEHPK3PXP');

    expect(cipher.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces different ciphertext each time, so equal secrets are not detectable', () => {
    expect(cipher.encrypt('JBSWY3DPEHPK3PXP')).not.toEqual(cipher.encrypt('JBSWY3DPEHPK3PXP'));
  });

  it('never stores the secret in the clear', () => {
    expect(cipher.encrypt('JBSWY3DPEHPK3PXP')).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('returns null for tampered ciphertext rather than garbage', () => {
    const sealed = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const tampered = `${sealed.slice(0, -4)}AAAA`;

    expect(cipher.decrypt(tampered)).toBeNull();
  });

  it('returns null when decrypted with a different key', () => {
    const sealed = cipher.encrypt('JBSWY3DPEHPK3PXP');

    expect(new SecretCipher(randomBytes(32).toString('base64')).decrypt(sealed)).toBeNull();
  });

  it('returns null for a malformed payload', () => {
    expect(cipher.decrypt('nonsense')).toBeNull();
  });
});

describe('SecretCipher without a configured key', () => {
  it('does not throw, warns once, and still round-trips', () => {
    const logger = createMockLogger();
    const fallback = new SecretCipher(createMockConfig({}), logger);

    const sealed = fallback.encrypt('JBSWY3DPEHPK3PXP');

    expect(fallback.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('generates a different random key per instance, so one cannot decrypt the other', () => {
    const first = new SecretCipher(createMockConfig({}), createMockLogger());
    const second = new SecretCipher(createMockConfig({}), createMockLogger());

    const sealed = first.encrypt('JBSWY3DPEHPK3PXP');

    expect(second.decrypt(sealed)).toBeNull();
  });
});

describe('SecretCipher with a misconfigured key', () => {
  it('throws when a configured key does not decode to 32 bytes', () => {
    const wrongLength = randomBytes(16).toString('base64');

    expect(() => new SecretCipher(wrongLength)).toThrow(
      'TOTP_ENCRYPTION_KEY must decode to 32 bytes, got 16',
    );
  });
});

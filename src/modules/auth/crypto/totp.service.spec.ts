import { TotpService } from './totp.service';

/** RFC 6238 Appendix B: ASCII secret "12345678901234567890", base32-encoded. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TotpService', () => {
  let totp: TotpService;

  beforeEach(() => {
    totp = new TotpService();
  });

  describe('RFC 6238 test vectors', () => {
    it.each([
      [59_000, '287082'],
      [1_111_111_109_000, '081804'],
      [1_111_111_111_000, '050471'],
      [1_234_567_890_000, '005924'],
      [2_000_000_000_000, '279037'],
    ])('produces the published code at %i ms', (atMs, expected) => {
      expect(totp.codeFor(RFC_SECRET, atMs)).toBe(expected);
    });
  });

  describe('verification window', () => {
    const now = 1_700_000_000_000;

    it('accepts the current step', () => {
      expect(totp.verify(RFC_SECRET, totp.codeFor(RFC_SECRET, now), null, now).ok).toBe(true);
    });

    it('accepts the previous step, for a slow clock', () => {
      const code = totp.codeFor(RFC_SECRET, now - 30_000);

      expect(totp.verify(RFC_SECRET, code, null, now).ok).toBe(true);
    });

    it('accepts the next step, for a fast clock', () => {
      const code = totp.codeFor(RFC_SECRET, now + 30_000);

      expect(totp.verify(RFC_SECRET, code, null, now).ok).toBe(true);
    });

    it('rejects two steps behind', () => {
      const code = totp.codeFor(RFC_SECRET, now - 90_000);

      expect(totp.verify(RFC_SECRET, code, null, now).ok).toBe(false);
    });

    it('rejects a wrong code', () => {
      expect(totp.verify(RFC_SECRET, '000000', null, now).ok).toBe(false);
    });

    it('rejects a code of the wrong length without throwing', () => {
      expect(totp.verify(RFC_SECRET, '12345', null, now).ok).toBe(false);
    });
  });

  describe('replay', () => {
    const now = 1_700_000_000_000;

    it('refuses a step that was already spent', () => {
      const code = totp.codeFor(RFC_SECRET, now);
      const first = totp.verify(RFC_SECRET, code, null, now);

      expect(first.ok).toBe(true);
      expect(totp.verify(RFC_SECRET, code, first.step, now).ok).toBe(false);
    });

    it('reports the step that was used, so the caller can persist it', () => {
      const code = totp.codeFor(RFC_SECRET, now);

      expect(totp.verify(RFC_SECRET, code, null, now).step).toBe(Math.floor(now / 1000 / 30));
    });
  });

  describe('enrolment', () => {
    it('generates a base32 secret', () => {
      expect(totp.generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
    });

    it('generates a different secret each time', () => {
      expect(totp.generateSecret()).not.toEqual(totp.generateSecret());
    });

    it('builds an otpauth URI naming the issuer and the account', () => {
      const uri = totp.buildUri(RFC_SECRET, 'rahim@example.com');

      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('rahim%40example.com');
      expect(uri).toContain(`secret=${RFC_SECRET}`);
      expect(uri).toContain('issuer=Barakah%20Bazaar');
    });
  });
});

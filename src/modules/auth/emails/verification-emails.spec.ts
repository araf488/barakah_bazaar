import {
  buildAlreadyRegisteredEmail,
  buildVerificationEmail,
  buildVerifiedEmail,
} from './verification-emails';

const LINK = 'https://barakahbazaar.com.bd/verify-email?token=abc123';
const CODE = '481920';

describe('verification emails', () => {
  describe('buildVerificationEmail', () => {
    const message = buildVerificationEmail({
      to: 'shopper@example.com',
      fullName: 'Aisha Rahman',
      link: LINK,
      code: CODE,
      ttlHours: 24,
    });

    it('carries both the link and the code, because either one may be the only usable path', () => {
      expect(message.body).toContain(LINK);
      expect(message.body).toContain(CODE);
      expect(message.html).toContain(LINK);
      expect(message.html).toContain(CODE);
    });

    it('states how long it is good for', () => {
      expect(message.body).toContain('24 hours');
      expect(message.html).toContain('24 hours');
    });

    it('greets by first name only', () => {
      expect(message.body).toContain('Aisha');
      expect(message.body).not.toContain('Aisha Rahman');
    });

    it('always has a plain-text body, which is what a spam filter reads', () => {
      expect(message.body.length).toBeGreaterThan(0);
    });
  });

  describe('buildAlreadyRegisteredEmail', () => {
    const message = buildAlreadyRegisteredEmail({
      to: 'shopper@example.com',
      fullName: 'Aisha Rahman',
    });

    // The load-bearing assertion of this whole template: whoever triggered it may not be the
    // account owner, so it must hand them nothing they could use.
    it('carries no credential of any kind', () => {
      const whole = `${message.body}${message.html ?? ''}`;

      expect(whole).not.toMatch(/token=/i);
      expect(whole).not.toMatch(/\b\d{6}\b/);
      expect(whole).not.toMatch(/verify-email/i);
    });

    it('tells the reader what to do instead', () => {
      expect(message.body.toLowerCase()).toContain('sign in');
    });
  });

  describe('buildVerifiedEmail', () => {
    it('confirms and carries no credential', () => {
      const message = buildVerifiedEmail({
        to: 'shopper@example.com',
        fullName: 'Aisha Rahman',
      });

      expect(message.subject.length).toBeGreaterThan(0);
      expect(`${message.body}${message.html ?? ''}`).not.toMatch(/\b\d{6}\b/);
    });
  });

  it('addresses every message to the recipient it was built for', () => {
    expect(buildVerifiedEmail({ to: 'shopper@example.com', fullName: 'A' }).to).toBe(
      'shopper@example.com',
    );
  });

  describe('handling empty and whitespace-only names', () => {
    it('buildVerificationEmail with empty name omits the name, not a stray comma or invented word', () => {
      const message = buildVerificationEmail({
        to: 'test@example.com',
        fullName: '',
        link: LINK,
        code: CODE,
        ttlHours: 24,
      });

      expect(message.body).toContain('Hello,');
      expect(message.body).not.toContain('Hello Friend,');
      expect(message.body).not.toMatch(/Hello\s+,/);
      expect(message.html).toContain('Hello,');
      expect(message.html).not.toContain('Hello Friend,');
      expect(message.html).not.toMatch(/Hello\s+,/);
    });

    it('buildVerificationEmail with whitespace-only name omits the name, not a stray comma or invented word', () => {
      const message = buildVerificationEmail({
        to: 'test@example.com',
        fullName: '   ',
        link: LINK,
        code: CODE,
        ttlHours: 24,
      });

      expect(message.body).toContain('Hello,');
      expect(message.body).not.toContain('Hello Friend,');
      expect(message.body).not.toMatch(/Hello\s+,/);
      expect(message.html).toContain('Hello,');
      expect(message.html).not.toContain('Hello Friend,');
      expect(message.html).not.toMatch(/Hello\s+,/);
    });

    it('buildAlreadyRegisteredEmail with empty name omits the name, not a stray comma or invented word', () => {
      const message = buildAlreadyRegisteredEmail({
        to: 'test@example.com',
        fullName: '',
      });

      expect(message.body).toContain('Hello,');
      expect(message.body).not.toContain('Hello Friend,');
      expect(message.body).not.toMatch(/Hello\s+,/);
      expect(message.html).toContain('Hello,');
      expect(message.html).not.toContain('Hello Friend,');
      expect(message.html).not.toMatch(/Hello\s+,/);
    });

    it('buildVerifiedEmail with empty name omits the name, not a stray comma or invented word', () => {
      const message = buildVerifiedEmail({
        to: 'test@example.com',
        fullName: '',
      });

      expect(message.body).toContain('Hello,');
      expect(message.body).not.toContain('Hello Friend,');
      expect(message.body).not.toMatch(/Hello\s+,/);
      expect(message.html).toContain('Hello,');
      expect(message.html).not.toContain('Hello Friend,');
      expect(message.html).not.toMatch(/Hello\s+,/);
    });
  });

  describe('HTML escaping in email bodies', () => {
    it('first name with HTML special characters appears escaped in HTML but unescaped in text', () => {
      const message = buildVerificationEmail({
        to: 'test@example.com',
        fullName: 'Bob& Rahman',
        link: LINK,
        code: CODE,
        ttlHours: 24,
      });

      // Plain text body: unescaped first name
      expect(message.body).toContain('Hello Bob&,');

      // HTML body: escaped first name
      expect(message.html).toContain('Hello Bob&amp;,');
      expect(message.html).not.toContain('Hello Bob&,');
    });

    it('escaping applies to all three builders', () => {
      const alreadyReg = buildAlreadyRegisteredEmail({
        to: 'test@example.com',
        fullName: 'Alice"Smith',
      });

      // HTML escaped (firstName extracts 'Alice"Smith' and escapes it)
      expect(alreadyReg.html).toContain('Hello Alice&quot;Smith,');
      // Text not escaped
      expect(alreadyReg.body).toContain('Hello Alice"Smith,');

      const verified = buildVerifiedEmail({
        to: 'test@example.com',
        fullName: 'Test<XSS> Name',
      });

      // HTML escaped (firstName extracts 'Test<XSS>')
      expect(verified.html).toContain('Hello Test&lt;XSS&gt;,');
      // Text not escaped
      expect(verified.body).toContain('Hello Test<XSS>,');
    });
  });
});

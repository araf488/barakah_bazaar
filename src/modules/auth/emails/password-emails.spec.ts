import { buildPasswordChangedEmail, buildPasswordResetEmail } from './password-emails';

const resetInput = {
  to: 'shopper@example.com',
  fullName: 'Aisha Rahman',
  link: 'http://localhost:3000/reset-password?token=abc123',
  code: '481920',
  ttlMinutes: 60,
};

describe('password emails', () => {
  describe('buildPasswordResetEmail', () => {
    it('carries both the link and the code, because either one may be the only usable one', () => {
      const message = buildPasswordResetEmail(resetInput);

      expect(message.body).toContain(
        'Open this link:\nhttp://localhost:3000/reset-password?token=abc123',
      );
      expect(message.body).toContain('Or enter this code in the app:\n481920');
      expect(message.html).toContain('href="http://localhost:3000/reset-password?token=abc123"');
      expect(message.html).toContain('481920');
    });

    it('states its lifetime in minutes', () => {
      expect(buildPasswordResetEmail(resetInput).body).toContain('60 minutes');
    });

    it('tells the reader that only the newest reset email works', () => {
      expect(buildPasswordResetEmail(resetInput).body).toContain('only the newest');
    });

    it('reassures someone who did not ask that nothing changed', () => {
      expect(buildPasswordResetEmail(resetInput).body).toContain('Your password has not changed');
    });

    it('greets by first name only, and omits the name rather than leaving a stray comma', () => {
      expect(buildPasswordResetEmail(resetInput).body.startsWith('Hello Aisha,')).toBe(true);
      expect(
        buildPasswordResetEmail({ ...resetInput, fullName: '   ' }).body.startsWith('Hello,'),
      ).toBe(true);
    });

    it('escapes the name in HTML but not in plain text', () => {
      const message = buildPasswordResetEmail({ ...resetInput, fullName: '<b>Aisha</b> Rahman' });

      expect(message.html).toContain('&lt;b&gt;Aisha&lt;/b&gt;');
      expect(message.body).toContain('<b>Aisha</b>');
    });

    it('is addressed to the recipient it was built for, with a subject naming the shop', () => {
      const message = buildPasswordResetEmail(resetInput);

      expect(message.to).toBe('shopper@example.com');
      expect(message.subject).toBe('Reset your Barakah Bazaar password');
    });
  });

  describe('buildPasswordChangedEmail', () => {
    const changedInput = { to: 'shopper@example.com', fullName: 'Aisha Rahman' };

    it('confirms the change and that other devices were signed out', () => {
      const message = buildPasswordChangedEmail(changedInput);

      expect(message.subject).toBe('Your Barakah Bazaar password was changed');
      expect(message.body).toContain('was just changed');
      expect(message.body).toContain('signed out');
    });

    it('tells someone who did not do this what to do', () => {
      expect(buildPasswordChangedEmail(changedInput).body).toContain('forgot password');
    });

    it('carries no credential and no link of any kind', () => {
      const message = buildPasswordChangedEmail(changedInput);
      const everything = `${message.body}\n${message.html ?? ''}`;

      expect(everything).not.toContain('token=');
      expect(everything).not.toContain('http');
      expect(everything).not.toMatch(/\d{6}/);
    });

    it('omits an empty name rather than leaving a stray comma', () => {
      expect(
        buildPasswordChangedEmail({ ...changedInput, fullName: '' }).body.startsWith('Hello,'),
      ).toBe(true);
    });
  });
});

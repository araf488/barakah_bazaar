import { buildPhoneChangedEmail } from './phone-changed-email';

describe('buildPhoneChangedEmail', () => {
  const message = buildPhoneChangedEmail({
    to: 'aisha@example.com',
    fullName: 'Aisha Rahman',
    lastDigits: '678',
  });

  it('addresses the account email with a subject that fits a first link and a change alike', () => {
    expect(message.to).toBe('aisha@example.com');
    expect(message.subject).toBe('A phone number was linked to your account');
  });

  it('greets by first name and names only the last 3 digits, in both bodies', () => {
    for (const text of [message.body, message.html ?? '']) {
      expect(text).toContain('Hello Aisha,');
      expect(text).toContain('ending in 678.');
    }
  });

  it('reads correctly when the account had no number before', () => {
    expect(message.body).toContain(
      'Your Barakah Bazaar account now has a verified phone number, ending in 678.',
    );
    expect(message.body).not.toMatch(/changed|replaced/i);
  });

  it('tells the owner that a password reset takes the number out of sign-in, in both bodies', () => {
    for (const text of [message.body, message.html ?? '']) {
      expect(text).toContain('Resetting your password also stops this number signing you in.');
    }
  });

  it('greets plainly when the account has no name', () => {
    const unnamed = buildPhoneChangedEmail({
      to: 'a@example.com',
      fullName: '',
      lastDigits: '678',
    });

    expect(unnamed.body.startsWith('Hello,')).toBe(true);
  });

  it('carries no link or code', () => {
    expect(message.body).not.toMatch(/https?:\/\//);
    expect(message.body).not.toMatch(/\d{6}/);
  });
});

import { createHash } from 'node:crypto';
import { hashInvitationToken } from './staff-invitation.token';

describe('hashInvitationToken', () => {
  it('is the hex SHA-256 of the raw token, matching rows already stored', () => {
    expect(hashInvitationToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });

  it('never returns the raw token', () => {
    const raw = 'q8Zk3pV0mN7xR2tL5wB9cY1dH4fJ6gS0aE3uI8oP2kQ';
    expect(hashInvitationToken(raw)).not.toContain(raw);
  });
});

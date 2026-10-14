import { createHash } from 'node:crypto';
import { hashInvitationToken } from './staff-invitation.token';

describe('hashInvitationToken', () => {
  it('is the hex SHA-256 of the raw token, matching rows already stored', () => {
    expect(hashInvitationToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });

  it('never returns the raw token', () => {
    expect(hashInvitationToken('abc')).not.toContain('abc');
  });
});

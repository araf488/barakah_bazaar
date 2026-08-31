import { StaffInvitationStatus, UserRole } from '../../infra/prisma/prisma-client';
import { StaffInvitationMapper } from './staff-invitation.mapper';

const row = (overrides = {}) => ({
  id: 'inv-1',
  email: 'ops@barakahbazaar.com.bd',
  role: UserRole.OPS,
  tokenHash: 'a'.repeat(64),
  status: StaffInvitationStatus.PENDING,
  expiresAt: new Date('2026-09-07T00:00:00.000Z'),
  invitedBy: 'user-1',
  acceptedBy: null,
  acceptedAt: null,
  revokedBy: null,
  revokedAt: null,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  ...overrides,
});

describe('StaffInvitationMapper', () => {
  it('maps every field of the contract', () => {
    expect(StaffInvitationMapper.toDto(row(), new Date('2026-09-01T00:00:00.000Z'))).toEqual({
      id: 'inv-1',
      email: 'ops@barakahbazaar.com.bd',
      role: UserRole.OPS,
      status: StaffInvitationStatus.PENDING,
      isExpired: false,
      expiresAt: '2026-09-07T00:00:00.000Z',
      invitedBy: 'user-1',
      acceptedAt: null,
      revokedAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    });
  });

  it('never exposes the token hash', () => {
    const dto = StaffInvitationMapper.toDto(row());

    expect(JSON.stringify(dto)).not.toContain('a'.repeat(64));
    expect(dto).not.toHaveProperty('tokenHash');
  });

  it('derives expiry from the deadline rather than the status column', () => {
    const dto = StaffInvitationMapper.toDto(row(), new Date('2026-09-08T00:00:00.000Z'));

    expect(dto.status).toBe(StaffInvitationStatus.PENDING);
    expect(dto.isExpired).toBe(true);
  });

  it('treats the exact deadline as expired', () => {
    expect(StaffInvitationMapper.toDto(row(), new Date('2026-09-07T00:00:00.000Z')).isExpired).toBe(
      true,
    );
  });

  it('serialises the acceptance timestamp when there is one', () => {
    const dto = StaffInvitationMapper.toDto(
      row({
        status: StaffInvitationStatus.ACCEPTED,
        acceptedAt: new Date('2026-09-02T10:00:00.000Z'),
      }),
    );

    expect(dto.acceptedAt).toBe('2026-09-02T10:00:00.000Z');
  });
});

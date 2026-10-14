import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { StaffInvitation, StaffInvitationStatus, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { PasswordPolicy } from '../auth/passwords/password-policy';
import { AuditLogWriteData } from './audit-log.repository';
import { StaffInvitationRepository } from './staff-invitation.repository';
import { StaffInvitationAcceptService } from './staff-invitation-accept.service';

const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);
const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

const invitation = (overrides = {}): StaffInvitation => ({
  id: 'inv-1',
  email: 'ops@barakahbazaar.com.bd',
  role: UserRole.OPS,
  tokenHash: 'hash',
  status: StaffInvitationStatus.PENDING,
  expiresAt: hourFromNow(),
  invitedBy: 'user-1',
  acceptedBy: null,
  acceptedAt: null,
  revokedBy: null,
  revokedAt: null,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  ...overrides,
});

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
const storedPasswordHash = 'scrypt$secret-password-hash';

const dto = { token: 'raw-token', password: 'Marbled Kingfisher 41!', fullName: 'Rafiq Ahmed' };

type AuditCallback = (
  updated: StaffInvitation,
  user: ReturnType<typeof userFixture>,
) => AuditLogWriteData;

describe('StaffInvitationAcceptService', () => {
  let repository: { findByTokenHash: jest.Mock; acceptCreatingAccount: jest.Mock };
  let hasher: { hash: jest.Mock };
  let policy: { check: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: StaffInvitationAcceptService;

  beforeEach(() => {
    repository = {
      findByTokenHash: jest.fn().mockResolvedValue(invitation()),
      acceptCreatingAccount: jest.fn().mockResolvedValue({ kind: 'accepted', userId: 'user-9' }),
    };
    hasher = { hash: jest.fn().mockResolvedValue('scrypt$x') };
    policy = { check: jest.fn().mockReturnValue(null) };
    logger = createMockLogger();
    service = new StaffInvitationAcceptService(
      repository as unknown as StaffInvitationRepository,
      hasher as unknown as PasswordHasher,
      policy as unknown as PasswordPolicy,
      logger,
    );
  });

  it('creates the account and answers exactly { accepted: true } — no token of any kind', async () => {
    await expect(service.accept(dto)).resolves.toStrictEqual({
      ok: true,
      data: { accepted: true },
    });
    expect(repository.acceptCreatingAccount).toHaveBeenCalledWith(
      invitation({ expiresAt: expect.any(Date) }),
      { passwordHash: 'scrypt$x', fullName: 'Rafiq Ahmed' },
      expect.any(Function),
    );
  });

  it('looks the invitation up by hash, never by the raw token', async () => {
    await service.accept(dto);

    expect(repository.findByTokenHash).toHaveBeenCalledWith(
      createHash('sha256').update('raw-token').digest('hex'),
    );
  });

  it('checks the policy against the invited email and the submitted name', async () => {
    await service.accept(dto);

    expect(policy.check).toHaveBeenCalledWith('Marbled Kingfisher 41!', {
      email: 'ops@barakahbazaar.com.bd',
      fullName: 'Rafiq Ahmed',
    });
  });

  it('trims the name once, so the policy and the repository both see the trimmed value', async () => {
    await service.accept({ ...dto, fullName: '  Rafiq Ahmed  ' });

    expect(policy.check).toHaveBeenCalledWith('Marbled Kingfisher 41!', {
      email: 'ops@barakahbazaar.com.bd',
      fullName: 'Rafiq Ahmed',
    });
    expect(repository.acceptCreatingAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fullName: 'Rafiq Ahmed' }),
      expect.any(Function),
    );
  });

  it('refuses a weak password with the policy message verbatim and writes nothing', async () => {
    policy.check.mockReturnValue('Your password must be at least 12 characters.');

    const result = await service.accept({ ...dto, password: 'short' });

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.BAD_REQUEST,
      message: 'Your password must be at least 12 characters.',
    });
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(repository.acceptCreatingAccount).not.toHaveBeenCalled();
  });

  it('checks the policy, then hashes, then writes — in that order', async () => {
    await service.accept(dto);

    const checked = policy.check.mock.invocationCallOrder[0];
    const hashed = hasher.hash.mock.invocationCallOrder[0];
    const written = repository.acceptCreatingAccount.mock.invocationCallOrder[0];

    expect(checked).toBeLessThan(hashed);
    expect(hashed).toBeLessThan(written);
  });

  it('answers an unknown, a revoked and an accepted invitation identically', async () => {
    // Otherwise the endpoint tells an attacker which tokens exist.
    const answers = [];
    for (const found of [
      undefined,
      invitation({ status: StaffInvitationStatus.REVOKED }),
      invitation({ status: StaffInvitationStatus.ACCEPTED }),
    ]) {
      repository.findByTokenHash.mockResolvedValue(found);
      answers.push(await service.accept(dto));
    }

    const invalid = {
      ok: false,
      status: HttpStatus.NOT_FOUND,
      message: 'This invitation link is not valid. Ask for a new one.',
    };
    expect(answers).toEqual([invalid, invalid, invalid]);
    expect(policy.check).not.toHaveBeenCalled();
    expect(repository.acceptCreatingAccount).not.toHaveBeenCalled();
  });

  it('refuses an expired invitation with 410', async () => {
    repository.findByTokenHash.mockResolvedValue(invitation({ expiresAt: hourAgo() }));

    const result = await service.accept(dto);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.GONE,
      message: 'This invitation has expired. Ask for a new one.',
    });
    expect(repository.acceptCreatingAccount).not.toHaveBeenCalled();
  });

  it('answers 409 with the invitee message when the address already has an account', async () => {
    repository.acceptCreatingAccount.mockResolvedValue({ kind: 'account-exists' });

    const result = await service.accept(dto);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.CONFLICT,
      message:
        'An account already exists for this email address. Sign in, and ask an administrator to change your role.',
    });
  });

  it('answers 409 when another accept won the race', async () => {
    repository.acceptCreatingAccount.mockResolvedValue({ kind: 'not-pending' });

    const result = await service.accept(dto);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.CONFLICT,
      message: 'This invitation is no longer open.',
    });
  });

  it('answers 503 when the lookup or the transaction faults', async () => {
    repository.findByTokenHash.mockResolvedValue(null);
    const lookup = await service.accept(dto);

    repository.findByTokenHash.mockResolvedValue(invitation());
    repository.acceptCreatingAccount.mockResolvedValue(null);
    const transaction = await service.accept(dto);

    const unavailable = {
      ok: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The service is temporarily unavailable. Please try again shortly.',
    };
    expect(lookup).toEqual(unavailable);
    expect(transaction).toEqual(unavailable);
  });

  it('audits the acceptance with the new account as the actor', async () => {
    await service.accept(dto);
    const audit = repository.acceptCreatingAccount.mock.calls[0][2] as AuditCallback;

    const row = audit(
      invitation({ status: StaffInvitationStatus.ACCEPTED, acceptedBy: 'user-9' }),
      userFixture({
        id: 'user-9',
        email: 'ops@barakahbazaar.com.bd',
        role: UserRole.OPS,
        passwordHash: storedPasswordHash,
      }),
    );

    expect(row).toMatchObject({
      actorId: 'user-9',
      actorEmail: 'ops@barakahbazaar.com.bd',
      actorRole: UserRole.OPS,
      action: 'staff.invitation_accepted',
      entityType: 'StaffInvitation',
      entityId: 'inv-1',
      requestId: null,
    });
    expect(row.before).toMatchObject({ status: StaffInvitationStatus.PENDING });
    expect(row.after).toMatchObject({
      status: StaffInvitationStatus.ACCEPTED,
      acceptedBy: 'user-9',
    });
    const serialised = JSON.stringify(row);
    // The token hash, and the new account's password hash, are credentials.
    expect(serialised).not.toContain('hash');
    expect(serialised).not.toContain(storedPasswordHash);
  });

  it('answers 500 and never logs the password or token when something throws', async () => {
    hasher.hash.mockRejectedValue(new Error('scrypt exploded'));

    const result = await service.accept(dto);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Something went wrong on our end. Please try again.',
    });
    expect(logger.error).toHaveBeenCalled();
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('raw-token');
    expect(logged).not.toContain('Marbled Kingfisher 41!');
  });
});

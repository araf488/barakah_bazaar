import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StaffInvitationStatus, UserRole } from '../../infra/prisma/prisma-client';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { AuthRepository } from '../auth/auth.repository';
import { EmailSender } from '../notification/ports/email-sender.port';
import { StaffInvitationRepository } from './staff-invitation.repository';
import { StaffInvitationService } from './staff-invitation.service';

const superAdmin: AuthenticatedUser = { supabaseUserId: 'sub-1', role: UserRole.SUPER_ADMIN };
const invitee: AuthenticatedUser = { supabaseUserId: 'sub-2', role: UserRole.CUSTOMER };

const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);
const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

const invitation = (overrides = {}) => ({
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

/** A stand-in that is NOT NoopEmailSender, so the token-echo branch stays off. */
class RealEmailSender implements EmailSender {
  send = jest.fn<Promise<boolean>, [unknown]>().mockResolvedValue(true);
}

describe('StaffInvitationService', () => {
  let repository: {
    createAudited: jest.Mock;
    settleAudited: jest.Mock;
    findByTokenHash: jest.Mock;
    findById: jest.Mock;
    findOpenForEmail: jest.Mock;
    findPage: jest.Mock;
  };
  let users: { findBySupabaseId: jest.Mock; findByEmail: jest.Mock };
  let supabaseAdmin: { setUserRole: jest.Mock };
  let email: RealEmailSender;
  let logger: jest.Mocked<PinoLogger>;
  let service: StaffInvitationService;

  const build = (sender: EmailSender = email, provider = 'resend') =>
    new StaffInvitationService(
      repository as unknown as StaffInvitationRepository,
      users as unknown as AuthRepository,
      supabaseAdmin as unknown as SupabaseAdminService,
      sender,
      createMockConfig({ EMAIL_PROVIDER: provider }),
      logger,
    );

  beforeEach(() => {
    repository = {
      createAudited: jest.fn().mockResolvedValue(invitation()),
      settleAudited: jest.fn().mockResolvedValue(invitation()),
      findByTokenHash: jest.fn(),
      findById: jest.fn(),
      findOpenForEmail: jest.fn().mockResolvedValue(undefined),
      findPage: jest.fn(),
    };
    users = {
      findBySupabaseId: jest
        .fn()
        .mockResolvedValue(userFixture({ id: 'user-1', role: UserRole.SUPER_ADMIN })),
      findByEmail: jest.fn().mockResolvedValue(undefined),
    };
    supabaseAdmin = { setUserRole: jest.fn().mockResolvedValue(true) };
    email = new RealEmailSender();
    logger = createMockLogger();
    service = build();
  });

  describe('invite', () => {
    it('stores only the hash of the token, never the token itself', async () => {
      await service.invite(superAdmin, {
        email: 'ops@barakahbazaar.com.bd',
        role: UserRole.OPS,
      });

      const stored = repository.createAudited.mock.calls[0][0] as { tokenHash: string };
      const emailed = (email.send.mock.calls[0][0] as { body: string }).body;

      expect(stored).not.toHaveProperty('token');
      expect(stored.tokenHash).toHaveLength(64);
      expect(emailed).not.toContain(stored.tokenHash);
      expect(createHash('sha256').update(extractToken(emailed)).digest('hex')).toBe(
        stored.tokenHash,
      );
    });

    it('lowercases the address so one email cannot hold two invitations by case', async () => {
      await service.invite(superAdmin, {
        email: 'OPS@BarakahBazaar.com.bd',
        role: UserRole.OPS,
      });

      expect(repository.createAudited.mock.calls[0][0].email).toBe('ops@barakahbazaar.com.bd');
      expect(users.findByEmail).toHaveBeenCalledWith('ops@barakahbazaar.com.bd');
    });

    it('sets a deadline a week out', async () => {
      await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      const { expiresAt } = repository.createAudited.mock.calls[0][0] as { expiresAt: Date };
      const days = Math.round((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

      expect(days).toBe(7);
    });

    it('never returns the token when a real email provider is configured', async () => {
      const result = await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      expect(result.ok && result.data.token).toBeNull();
    });

    it('returns the token only while EMAIL_PROVIDER is noop, so the flow works with no mailbox', async () => {
      const result = await build(email, 'noop').invite(superAdmin, {
        email: 'a@b.com',
        role: UserRole.OPS,
      });

      expect(result.ok && result.data.token).toEqual(expect.any(String));
    });

    it('withholds the token whenever a provider is configured, even if the send fails', async () => {
      // The safe direction. An invitation nobody received is recoverable; a bearer credential
      // in an API response is not.
      email.send.mockResolvedValue(false);

      const result = await build(email, 'resend').invite(superAdmin, {
        email: 'a@b.com',
        role: UserRole.OPS,
      });

      expect(result.ok && result.data.token).toBeNull();
      expect(result.ok && result.data.emailSent).toBe(false);
    });

    it('refuses an address that already has an account', async () => {
      users.findByEmail.mockResolvedValue(userFixture());

      const result = await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That email already has an account. Change its role instead of inviting it.',
      });
      expect(repository.createAudited).not.toHaveBeenCalled();
    });

    it('refuses a second invitation while one is still open', async () => {
      repository.findOpenForEmail.mockResolvedValue(invitation());

      const result = await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That email already has an open invitation. Revoke it before sending another.',
      });
    });

    it('allows a fresh invitation once the previous one has expired', async () => {
      repository.findOpenForEmail.mockResolvedValue(invitation({ expiresAt: hourAgo() }));

      const result = await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      expect(result.ok).toBe(true);
    });

    it('refuses the invitation when its audit row cannot be written', async () => {
      repository.createAudited.mockResolvedValue(null);

      const result = await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      expect(result.ok).toBe(false);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('keeps the invitation when the email fails, and says so', async () => {
      email.send.mockRejectedValue(new Error('smtp down'));

      const result = await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.emailSent).toBe(false);
    });

    it('never logs the token, even on failure', async () => {
      email.send.mockRejectedValue(new Error('smtp down'));

      await service.invite(superAdmin, { email: 'a@b.com', role: UserRole.OPS });

      const logged = JSON.stringify(logger.error.mock.calls);
      const stored = repository.createAudited.mock.calls[0][0] as { tokenHash: string };

      expect(logged).not.toContain(stored.tokenHash);
    });
  });

  describe('accept', () => {
    beforeEach(() => {
      users.findBySupabaseId.mockResolvedValue(
        userFixture({ id: 'user-2', email: 'ops@barakahbazaar.com.bd', role: UserRole.CUSTOMER }),
      );
      repository.findByTokenHash.mockResolvedValue(invitation());
      repository.settleAudited.mockResolvedValue(
        invitation({ status: StaffInvitationStatus.ACCEPTED, acceptedBy: 'user-2' }),
      );
    });

    it('looks the invitation up by hash, never by the raw token', async () => {
      await service.accept(invitee, { token: 'plain-token' });

      expect(repository.findByTokenHash).toHaveBeenCalledWith(
        createHash('sha256').update('plain-token').digest('hex'),
      );
    });

    it('grants the role in Supabase before closing the invitation', async () => {
      await service.accept(invitee, { token: 'plain-token' });

      expect(supabaseAdmin.setUserRole.mock.invocationCallOrder[0]).toBeLessThan(
        repository.settleAudited.mock.invocationCallOrder[0],
      );
      expect(supabaseAdmin.setUserRole).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        UserRole.OPS,
      );
    });

    it('refuses when the signed-in email is not the invited one', async () => {
      // The check that makes the token safe to email: possession alone is not enough.
      users.findBySupabaseId.mockResolvedValue(
        userFixture({ id: 'user-3', email: 'someone.else@example.com' }),
      );

      const result = await service.accept(invitee, { token: 'plain-token' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message:
          'This invitation was sent to a different email address. Sign in as that address to accept it.',
      });
      expect(supabaseAdmin.setUserRole).not.toHaveBeenCalled();
    });

    it('matches the invited email case-insensitively', async () => {
      users.findBySupabaseId.mockResolvedValue(
        userFixture({ id: 'user-2', email: 'OPS@BarakahBazaar.com.bd' }),
      );

      const result = await service.accept(invitee, { token: 'plain-token' });

      expect(result.ok).toBe(true);
    });

    it('refuses an account with no email at all', async () => {
      users.findBySupabaseId.mockResolvedValue(userFixture({ id: 'user-2', email: null }));

      const result = await service.accept(invitee, { token: 'plain-token' });

      expect(result.ok).toBe(false);
      expect(supabaseAdmin.setUserRole).not.toHaveBeenCalled();
    });

    it('answers a revoked invitation exactly as it answers an unknown token', async () => {
      // Otherwise the endpoint tells an attacker which tokens exist.
      repository.findByTokenHash.mockResolvedValue(undefined);
      const unknown = await service.accept(invitee, { token: 'plain-token' });

      repository.findByTokenHash.mockResolvedValue(
        invitation({ status: StaffInvitationStatus.REVOKED }),
      );
      const revoked = await service.accept(invitee, { token: 'plain-token' });

      expect(unknown).toEqual(revoked);
      expect(unknown).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'This invitation link is not valid. Ask for a new one.',
      });
    });

    it('refuses an expired invitation', async () => {
      repository.findByTokenHash.mockResolvedValue(invitation({ expiresAt: hourAgo() }));

      const result = await service.accept(invitee, { token: 'plain-token' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.GONE,
        message: 'This invitation has expired. Ask for a new one.',
      });
      expect(supabaseAdmin.setUserRole).not.toHaveBeenCalled();
    });

    it('leaves the invitation open when the identity provider refuses the role', async () => {
      supabaseAdmin.setUserRole.mockResolvedValue(false);

      const result = await service.accept(invitee, { token: 'plain-token' });

      expect(result.ok).toBe(false);
      expect(repository.settleAudited).not.toHaveBeenCalled();
    });

    it('reports a partial grant loudly when the role landed but the row did not', async () => {
      repository.settleAudited.mockResolvedValue(null);

      const result = await service.accept(invitee, { token: 'plain-token' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          'The role was granted but the invitation could not be closed. Contact a super admin.',
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('reports 503 rather than an invalid token when the lookup failed', async () => {
      repository.findByTokenHash.mockResolvedValue(null);

      const result = await service.accept(invitee, { token: 'plain-token' });

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('revoke', () => {
    it('closes an open invitation', async () => {
      repository.findById.mockResolvedValue(invitation());
      repository.settleAudited.mockResolvedValue(
        invitation({ status: StaffInvitationStatus.REVOKED }),
      );

      const result = await service.revoke(superAdmin, 'inv-1');

      expect(result.ok).toBe(true);
      expect(repository.settleAudited.mock.calls[0][1]).toMatchObject({
        status: StaffInvitationStatus.REVOKED,
        revokedBy: 'user-1',
      });
    });

    it('refuses to revoke one that was already accepted', async () => {
      repository.findById.mockResolvedValue(invitation({ status: StaffInvitationStatus.ACCEPTED }));

      const result = await service.revoke(superAdmin, 'inv-1');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This invitation is no longer open.',
      });
      expect(repository.settleAudited).not.toHaveBeenCalled();
    });

    it('reports the race as a conflict when someone else settled it first', async () => {
      repository.findById.mockResolvedValue(invitation());
      repository.settleAudited.mockResolvedValue(null);

      const result = await service.revoke(superAdmin, 'inv-1');

      expect(result.ok === false && result.status).toBe(HttpStatus.CONFLICT);
    });

    it('reports 404 for an invitation that does not exist', async () => {
      repository.findById.mockResolvedValue(undefined);

      const result = await service.revoke(superAdmin, 'inv-1');

      expect(result.ok === false && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('list', () => {
    it('filters by status when asked', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 0 });

      await service.list({ status: StaffInvitationStatus.PENDING });

      expect(repository.findPage.mock.calls[0][0]).toEqual({
        status: StaffInvitationStatus.PENDING,
      });
    });

    it('never returns a token hash', async () => {
      repository.findPage.mockResolvedValue({ items: [invitation()], total: 1 });

      const result = await service.list({});

      expect(result.ok && JSON.stringify(result.data)).not.toContain('tokenHash');
    });

    it('marks an expired row expired without changing its status', async () => {
      repository.findPage.mockResolvedValue({
        items: [invitation({ expiresAt: hourAgo() })],
        total: 1,
      });

      const result = await service.list({});

      expect(result.ok && result.data.items[0]).toMatchObject({
        status: StaffInvitationStatus.PENDING,
        isExpired: true,
      });
    });
  });
});

/** Pulls the token back out of the rendered email body. */
function extractToken(body: string): string {
  const match = /\n\s{2}(\S+)\n/.exec(body);
  return match ? match[1] : '';
}

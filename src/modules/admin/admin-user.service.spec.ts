import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { AuthService } from '../auth/auth.service';
import { AdminUserRepository } from './admin-user.repository';
import { AdminUserService } from './admin-user.service';
import { AdminUserQueryDto } from './dto/admin-user.dto';

const actor: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'boss@barakahbazaar.com.bd',
  role: UserRole.SUPER_ADMIN,
};

const listQuery = (): AdminUserQueryDto => new AdminUserQueryDto();

const target = (overrides = {}) =>
  userFixture({ id: 'user-2', supabaseUserId: 'sub-2', role: UserRole.CUSTOMER, ...overrides });

describe('AdminUserService', () => {
  let repository: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let supabaseAdmin: { setUserRole: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AdminUserService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(target()),
      findPage: jest.fn().mockResolvedValue({ items: [userFixture()], total: 1 }),
      countActiveSuperAdmins: jest.fn().mockResolvedValue(2),
      updateAudited: jest.fn().mockResolvedValue(target()),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    supabaseAdmin = { setUserRole: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();
    service = new AdminUserService(
      repository as unknown as AdminUserRepository,
      authService as unknown as AuthService,
      supabaseAdmin as unknown as SupabaseAdminService,
      logger,
    );
  });

  const auditOf = (mock: jest.Mock): Record<string, unknown> => {
    const calls = mock.mock.calls as unknown[][];
    const build = calls[0][calls[0].length - 1] as (row: unknown) => Record<string, unknown>;
    return build(target());
  };

  describe('listUsers', () => {
    it('returns the mapped page including staff-only fields', async () => {
      const result = await service.listUsers(listQuery());

      expect(result.ok && result.data.items[0]).toEqual(
        expect.objectContaining({ isActive: true, lastSeenAt: expect.any(Date) }),
      );
    });

    it('answers 503 when the read failed', async () => {
      repository.findPage.mockResolvedValue(null);

      const result = await service.listUsers(listQuery());

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('setAccountEnabled', () => {
    it('disables an account and audits it', async () => {
      const result = await service.setAccountEnabled(actor, 'user-2', false);

      expect(result.ok).toBe(true);
      expect(repository.updateAudited.mock.calls[0][1]).toEqual({ isActive: false });
      expect(auditOf(repository.updateAudited).action).toBe('customer.disabled');
    });

    it('re-enables and records the opposite action', async () => {
      await service.setAccountEnabled(actor, 'user-2', true);

      expect(auditOf(repository.updateAudited).action).toBe('customer.enabled');
    });

    it('refuses to act on your own account', async () => {
      // One mistaken click would otherwise lock the operator out of their own system.
      const result = await service.setAccountEnabled(actor, 'user-1', false);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message:
          'You cannot change your own account here. Ask another super admin to make this change.',
      });
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('refuses to disable the last enabled super admin', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));
      repository.countActiveSuperAdmins.mockResolvedValue(1);

      const result = await service.setAccountEnabled(actor, 'user-2', false);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This is the only super admin. Promote someone else before changing this account.',
      });
    });

    it('allows disabling a super admin while others remain', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));
      repository.countActiveSuperAdmins.mockResolvedValue(3);

      await expect(service.setAccountEnabled(actor, 'user-2', false)).resolves.toEqual(
        expect.objectContaining({ ok: true }),
      );
    });

    it('does not run the lockout check when enabling', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));

      await service.setAccountEnabled(actor, 'user-2', true);

      expect(repository.countActiveSuperAdmins).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown account', async () => {
      repository.findById.mockResolvedValue(undefined);

      const result = await service.setAccountEnabled(actor, 'user-9', false);

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('changeRole', () => {
    it('writes Supabase first, because the JWT claim is the source of truth', async () => {
      // The column alone would be re-mirrored from the token within seconds.
      await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(supabaseAdmin.setUserRole).toHaveBeenCalledWith('sub-2', UserRole.OPS);
      expect(supabaseAdmin.setUserRole.mock.invocationCallOrder[0]).toBeLessThan(
        repository.updateAudited.mock.invocationCallOrder[0],
      );
    });

    it('mirrors the new role locally and audits the change', async () => {
      await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(repository.updateAudited.mock.calls[0][1]).toEqual({ role: UserRole.OPS });
      expect(auditOf(repository.updateAudited).action).toBe('staff.role_changed');
    });

    it('changes nothing when the identity provider refuses', async () => {
      supabaseAdmin.setUserRole.mockResolvedValue(false);

      const result = await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The role could not be updated in the identity provider. Nothing was changed.',
      });
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('reports a partial change and logs everything needed to reconcile', async () => {
      // Supabase is already authoritative; the audit row is what was lost.
      repository.updateAudited.mockResolvedValue(null);

      const result = await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(!result.ok && result.message).toBe(
        'The role was changed in the identity provider but could not be recorded locally. Contact an administrator before making further changes.',
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'user-2',
          supabaseUserId: 'sub-2',
          previousRole: UserRole.CUSTOMER,
          newRole: UserRole.OPS,
        }),
        'Role changed in Supabase but the local record and its audit row failed to write',
      );
    });

    it('is a no-op when the role already matches', async () => {
      const result = await service.changeRole(actor, 'user-2', { role: UserRole.CUSTOMER });

      expect(result.ok).toBe(true);
      expect(supabaseAdmin.setUserRole).not.toHaveBeenCalled();
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('refuses to change your own role', async () => {
      const result = await service.changeRole(actor, 'user-1', { role: UserRole.OPS });

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(supabaseAdmin.setUserRole).not.toHaveBeenCalled();
    });

    it('refuses to demote the last super admin', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));
      repository.countActiveSuperAdmins.mockResolvedValue(1);

      const result = await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(!result.ok && result.status).toBe(HttpStatus.CONFLICT);
      expect(supabaseAdmin.setUserRole).not.toHaveBeenCalled();
    });

    it('allows promoting someone to super admin without a lockout check', async () => {
      const result = await service.changeRole(actor, 'user-2', { role: UserRole.SUPER_ADMIN });

      expect(result.ok).toBe(true);
      expect(repository.countActiveSuperAdmins).not.toHaveBeenCalled();
    });
  });
});

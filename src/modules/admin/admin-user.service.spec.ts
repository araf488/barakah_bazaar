import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
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
  userFixture({ id: 'user-2', role: UserRole.CUSTOMER, ...overrides });

describe('AdminUserService', () => {
  let repository: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
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
    logger = createMockLogger();
    service = new AdminUserService(
      repository as unknown as AdminUserRepository,
      authService as unknown as AuthService,
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
    it('writes the role to the column, the only place a role now lives', async () => {
      await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(repository.updateAudited.mock.calls[0][1]).toEqual({ role: UserRole.OPS });
      expect(auditOf(repository.updateAudited).action).toBe('staff.role_changed');
    });

    it('changes nothing when the write and its audit row roll back', async () => {
      // Row and audit entry share one transaction, so there is no half-applied role to
      // reconcile: the failure is total and the caller can simply retry.
      repository.updateAudited.mockResolvedValue(null);

      const result = await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'The change could not be recorded in the audit trail and was not applied. Please try again.',
      });
    });

    it('is a no-op when the role already matches', async () => {
      const result = await service.changeRole(actor, 'user-2', { role: UserRole.CUSTOMER });

      expect(result.ok).toBe(true);
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('refuses to change your own role', async () => {
      const result = await service.changeRole(actor, 'user-1', { role: UserRole.OPS });

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('refuses to demote the last super admin', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));
      repository.countActiveSuperAdmins.mockResolvedValue(1);

      const result = await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(!result.ok && result.status).toBe(HttpStatus.CONFLICT);
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('allows promoting someone to super admin without a lockout check', async () => {
      const result = await service.changeRole(actor, 'user-2', { role: UserRole.SUPER_ADMIN });

      expect(result.ok).toBe(true);
      expect(repository.countActiveSuperAdmins).not.toHaveBeenCalled();
    });
  });
});

import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { UserRole } from '../../infra/prisma/prisma-client';
import { SessionCachePort } from '../auth/sessions/session-cache.port';
import { AdminUserRepository } from './admin-user.repository';
import { AuditLogRepository } from './audit-log.repository';
import { AdminUserQueryDto } from './dto/admin-user.dto';

const query = (overrides: Partial<AdminUserQueryDto> = {}): AdminUserQueryDto =>
  Object.assign(new AdminUserQueryDto(), overrides);

describe('AdminUserRepository', () => {
  let user: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock; update: jest.Mock };
  let prisma: { user: typeof user; $transaction: jest.Mock };
  let auditLog: { appendWithin: jest.Mock };
  let sessionCache: { invalidateUser: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: AdminUserRepository;

  beforeEach(() => {
    user = { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() };
    prisma = {
      user,
      $transaction: jest.fn((arg: unknown) =>
        Array.isArray(arg)
          ? Promise.all(arg as Promise<unknown>[])
          : (arg as (tx: { user: typeof user }) => unknown)({ user }),
      ),
    };
    auditLog = { appendWithin: jest.fn().mockResolvedValue(undefined) };
    sessionCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    repository = new AdminUserRepository(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogRepository,
      sessionCache as unknown as SessionCachePort,
      logger,
    );
  });

  describe('findPage', () => {
    beforeEach(() => {
      user.findMany.mockResolvedValue([userFixture()]);
      user.count.mockResolvedValue(1);
    });

    it('returns the page with its total', async () => {
      await expect(repository.findPage(query())).resolves.toEqual({
        items: [userFixture()],
        total: 1,
      });
    });

    it('searches email, phone and name together', async () => {
      await repository.findPage(query({ search: 'rahim' }));

      expect(user.findMany.mock.calls[0][0].where.OR).toEqual([
        { email: { contains: 'rahim', mode: 'insensitive' } },
        { phone: { contains: 'rahim' } },
        { fullName: { contains: 'rahim', mode: 'insensitive' } },
      ]);
    });

    it('narrows by role', async () => {
      await repository.findPage(query({ role: UserRole.OPS }));

      expect(user.findMany.mock.calls[0][0].where.role).toBe(UserRole.OPS);
    });

    it('distinguishes disabled accounts from an absent filter', async () => {
      await repository.findPage(query({ isActive: false }));

      expect(user.findMany.mock.calls[0][0].where.isActive).toBe(false);
    });

    it('applies no filter when none was asked for', async () => {
      await repository.findPage(query());

      expect(user.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('returns null when the read failed', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findPage(query())).resolves.toBeNull();
    });
  });

  describe('updateAudited', () => {
    it('writes the row and its audit entry in one transaction', async () => {
      user.update.mockResolvedValue(userFixture());

      await repository.updateAudited('user-2', { isActive: false }, () => ({}) as never);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(auditLog.appendWithin).toHaveBeenCalledTimes(1);
    });

    it('returns null when the audit half throws, so nothing stands unrecorded', async () => {
      user.update.mockResolvedValue(userFixture());
      auditLog.appendWithin.mockRejectedValue(new Error('audit insert failed'));

      await expect(
        repository.updateAudited('user-2', { isActive: false }, () => ({}) as never),
      ).resolves.toBeNull();
    });

    it('returns null when the update itself fails', async () => {
      user.update.mockRejectedValue(new Error('connection refused'));

      await expect(
        repository.updateAudited('user-2', { isActive: false }, () => ({}) as never),
      ).resolves.toBeNull();
    });

    it('bumps the session-cache generation once the transaction commits', async () => {
      user.update.mockResolvedValue(userFixture());

      await repository.updateAudited('user-2', { isActive: false }, () => ({}) as never);

      expect(sessionCache.invalidateUser).toHaveBeenCalledWith('user-2');
    });

    it('bumps the generation on a role change too — the demotion case', async () => {
      user.update.mockResolvedValue(userFixture({ role: UserRole.OPS }));

      await repository.updateAudited('user-2', { role: UserRole.OPS }, () => ({}) as never);

      expect(sessionCache.invalidateUser).toHaveBeenCalledWith('user-2');
    });

    it('does not bump the cache when the transaction fails', async () => {
      user.update.mockRejectedValue(new Error('connection refused'));

      await repository.updateAudited('user-2', { isActive: false }, () => ({}) as never);

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('does not bump the cache when the audit write fails the transaction', async () => {
      user.update.mockResolvedValue(userFixture());
      auditLog.appendWithin.mockRejectedValue(new Error('audit insert failed'));

      await repository.updateAudited('user-2', { isActive: false }, () => ({}) as never);

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('countActiveSuperAdmins', () => {
    it('counts only enabled super admins', async () => {
      user.count.mockResolvedValue(2);

      await expect(repository.countActiveSuperAdmins()).resolves.toBe(2);
      expect(user.count).toHaveBeenCalledWith({
        where: { role: UserRole.SUPER_ADMIN, isActive: true },
      });
    });

    it('returns null when the count failed', async () => {
      user.count.mockRejectedValue(new Error('connection refused'));

      await expect(repository.countActiveSuperAdmins()).resolves.toBeNull();
    });
  });
});

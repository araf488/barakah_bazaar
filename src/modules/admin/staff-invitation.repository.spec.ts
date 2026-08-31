import { PinoLogger } from 'nestjs-pino';
import { StaffInvitationStatus, UserRole } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuditLogRepository } from './audit-log.repository';
import { StaffInvitationRepository } from './staff-invitation.repository';

const auditRow = () => ({
  actorId: 'user-1',
  actorEmail: 'admin@barakahbazaar.com.bd',
  actorRole: UserRole.SUPER_ADMIN,
  action: 'staff.invited',
  entityType: 'StaffInvitation',
  entityId: 'inv-1',
  before: undefined,
  after: undefined,
  requestId: null,
});

describe('StaffInvitationRepository', () => {
  let tx: {
    staffInvitation: {
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let prisma: {
    $transaction: jest.Mock;
    staffInvitation: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let auditLog: { appendWithin: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: StaffInvitationRepository;

  beforeEach(() => {
    tx = {
      staffInvitation: {
        create: jest.fn().mockResolvedValue({ id: 'inv-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      },
    };
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
      staffInvitation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    auditLog = { appendWithin: jest.fn() };
    logger = createMockLogger();
    repository = new StaffInvitationRepository(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogRepository,
      logger,
    );
  });

  const createData = {
    email: 'ops@barakahbazaar.com.bd',
    role: UserRole.OPS,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-09-07T00:00:00.000Z'),
    invitedBy: 'user-1',
  };

  describe('createAudited', () => {
    it('writes the invitation and its audit row in one transaction', async () => {
      await repository.createAudited(createData, () => auditRow());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.staffInvitation.create).toHaveBeenCalled();
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow());
    });

    it('returns null so the caller refuses when the audit row fails', async () => {
      auditLog.appendWithin.mockRejectedValue(new Error('audit table gone'));

      await expect(repository.createAudited(createData, () => auditRow())).resolves.toBeNull();
    });

    it('never logs the token hash', async () => {
      prisma.$transaction.mockRejectedValue(new Error('duplicate key'));

      await repository.createAudited(createData, () => auditRow());

      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(createData.tokenHash);
    });
  });

  describe('settleAudited', () => {
    it('only settles a row that is still pending', async () => {
      await repository.settleAudited('inv-1', { status: StaffInvitationStatus.REVOKED }, () =>
        auditRow(),
      );

      expect(tx.staffInvitation.updateMany.mock.calls[0][0].where).toEqual({
        id: 'inv-1',
        status: StaffInvitationStatus.PENDING,
      });
    });

    it('returns null when another caller settled it first, without writing an audit row', async () => {
      tx.staffInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.settleAudited('inv-1', { status: StaffInvitationStatus.ACCEPTED }, () =>
          auditRow(),
        ),
      ).resolves.toBeNull();

      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('logs a lost race at info, not as an error', async () => {
      tx.staffInvitation.updateMany.mockResolvedValue({ count: 0 });

      await repository.settleAudited('inv-1', {}, () => auditRow());

      expect(logger.info).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs a genuine fault as an error', async () => {
      tx.staffInvitation.updateMany.mockRejectedValue(new Error('connection reset'));

      await repository.settleAudited('inv-1', {}, () => auditRow());

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('findByTokenHash', () => {
    it('returns undefined for a hash that matches nothing', async () => {
      prisma.staffInvitation.findUnique.mockResolvedValue(null);

      await expect(repository.findByTokenHash('a'.repeat(64))).resolves.toBeUndefined();
    });

    it('returns null when the lookup itself fails', async () => {
      prisma.staffInvitation.findUnique.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findByTokenHash('a'.repeat(64))).resolves.toBeNull();
    });

    it('never logs the hash it was given', async () => {
      const hash = 'b'.repeat(64);
      prisma.staffInvitation.findUnique.mockRejectedValue(new Error('connection reset'));

      await repository.findByTokenHash(hash);

      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(hash);
    });
  });

  describe('findOpenForEmail', () => {
    it('asks only for a pending invitation, newest first', async () => {
      prisma.staffInvitation.findFirst.mockResolvedValue(null);

      await repository.findOpenForEmail('ops@barakahbazaar.com.bd');

      expect(prisma.staffInvitation.findFirst.mock.calls[0][0]).toEqual({
        where: { email: 'ops@barakahbazaar.com.bd', status: StaffInvitationStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns null when the lookup fails', async () => {
      prisma.staffInvitation.findFirst.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findOpenForEmail('a@b.com')).resolves.toBeNull();
    });
  });

  describe('findPage', () => {
    it('returns the page and its count', async () => {
      prisma.staffInvitation.findMany.mockResolvedValue([{ id: 'inv-1' }]);
      prisma.staffInvitation.count.mockResolvedValue(1);

      await expect(repository.findPage({}, 0, 50)).resolves.toEqual({
        items: [{ id: 'inv-1' }],
        total: 1,
      });
    });

    it('returns null when the page cannot be read', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findPage({}, 0, 50)).resolves.toBeNull();
    });
  });
});

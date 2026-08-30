import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { auditEntryFixture } from '../../../test/support/admin-fixtures';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AuditLogRepository, AuditLogWriteData } from './audit-log.repository';
import { AuditLogQueryDto } from './dto/audit-log.dto';

const writeData: AuditLogWriteData = {
  actorId: 'user-1',
  actorEmail: 'ops@barakahbazaar.com.bd',
  actorRole: UserRole.SUPER_ADMIN,
  action: 'product.published',
  entityType: 'Product',
  entityId: 'product-1',
  before: undefined,
  after: { isActive: true },
  requestId: 'trace-1',
};

const query = (overrides: Partial<AuditLogQueryDto> = {}): AuditLogQueryDto =>
  Object.assign(new AuditLogQueryDto(), overrides);

describe('AuditLogRepository', () => {
  let adminAuditLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  let prisma: { adminAuditLog: typeof adminAuditLog; $transaction: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: AuditLogRepository;

  beforeEach(() => {
    adminAuditLog = { create: jest.fn(), findMany: jest.fn(), count: jest.fn() };
    prisma = {
      adminAuditLog,
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    logger = createMockLogger();
    repository = new AuditLogRepository(prisma as unknown as PrismaService, logger);
  });

  describe('append', () => {
    it('writes the row and reports success', async () => {
      adminAuditLog.create.mockResolvedValue(auditEntryFixture());

      await expect(repository.append(writeData)).resolves.toBe(true);
      expect(adminAuditLog.create).toHaveBeenCalledWith({ data: writeData });
    });

    it('reports failure instead of throwing, so the caller can decide', async () => {
      adminAuditLog.create.mockRejectedValue(new Error('connection refused'));

      await expect(repository.append(writeData)).resolves.toBe(false);
    });

    it('logs a failed append with the exception object', async () => {
      const failure = new Error('connection refused');
      adminAuditLog.create.mockRejectedValue(failure);

      await repository.append(writeData);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure, action: 'product.published' }),
        'Exception occurred in AuditLogRepository.append',
      );
    });

    it('exposes no update or delete — an editable audit log is not an audit log', () => {
      const surface = Object.getOwnPropertyNames(AuditLogRepository.prototype);

      expect(surface).not.toContain('update');
      expect(surface).not.toContain('delete');
      expect(surface.filter((name) => /update|delete|remove/i.test(name))).toEqual([]);
    });
  });

  describe('findPage', () => {
    beforeEach(() => {
      adminAuditLog.findMany.mockResolvedValue([auditEntryFixture()]);
      adminAuditLog.count.mockResolvedValue(1);
    });

    it('returns the page with its total', async () => {
      await expect(repository.findPage(query())).resolves.toEqual({
        items: [auditEntryFixture()],
        total: 1,
      });
    });

    it('orders newest first', async () => {
      await repository.findPage(query());

      expect(adminAuditLog.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    });

    it('counts against the same predicate it reads with', async () => {
      await repository.findPage(query({ action: 'product.published' }));

      expect(adminAuditLog.findMany.mock.calls[0][0].where).toEqual(
        adminAuditLog.count.mock.calls[0][0].where,
      );
    });

    it('applies no filter when none was asked for', async () => {
      await repository.findPage(query());

      expect(adminAuditLog.findMany.mock.calls[0][0].where).toEqual({});
    });

    it.each([
      ['action', { action: 'product.published' }],
      ['entityType', { entityType: 'Product' }],
      ['entityId', { entityId: 'product-1' }],
      ['actorId', { actorId: 'user-1' }],
    ])('narrows by %s', async (_field, filter) => {
      await repository.findPage(query(filter));

      expect(adminAuditLog.findMany.mock.calls[0][0].where).toEqual(filter);
    });

    it('treats from as inclusive and until as exclusive, so day ranges do not overlap', async () => {
      await repository.findPage(
        query({ from: '2026-08-01T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z' }),
      );

      expect(adminAuditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({
        gte: new Date('2026-08-01T00:00:00.000Z'),
        lt: new Date('2026-09-01T00:00:00.000Z'),
      });
    });

    it('accepts an open-ended range', async () => {
      await repository.findPage(query({ from: '2026-08-01T00:00:00.000Z' }));

      expect(adminAuditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({
        gte: new Date('2026-08-01T00:00:00.000Z'),
      });
    });

    it('returns null instead of throwing when the read failed', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findPage(query())).resolves.toBeNull();
    });
  });
});

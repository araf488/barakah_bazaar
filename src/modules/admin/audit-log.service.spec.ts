import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { auditEntryFixture } from '../../../test/support/admin-fixtures';
import { AdminAuditActions, AdminAuditEntities } from './admin.constants';
import { AuditContext, AuditLogService } from './audit-log.service';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogQueryDto } from './dto/audit-log.dto';

const actor: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'ops@barakahbazaar.com.bd',
  role: UserRole.SUPER_ADMIN,
};

const context = (overrides: Partial<AuditContext> = {}): AuditContext => ({
  actor,
  actorId: 'user-1',
  action: AdminAuditActions.ProductPublished,
  entityType: AdminAuditEntities.Product,
  entityId: 'product-1',
  requestId: 'trace-1',
  ...overrides,
});

describe('AuditLogService', () => {
  let repository: { append: jest.Mock; findPage: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AuditLogService;

  beforeEach(() => {
    repository = { append: jest.fn().mockResolvedValue(true), findPage: jest.fn() };
    logger = createMockLogger();
    service = new AuditLogService(repository as unknown as AuditLogRepository, logger);
  });

  describe('record', () => {
    it('records the actor from the verified token, not from the caller', async () => {
      await service.record(context());

      expect(repository.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          actorEmail: 'ops@barakahbazaar.com.bd',
          actorRole: UserRole.SUPER_ADMIN,
        }),
      );
    });

    it('carries the request id so a log line ties back to the audit row', async () => {
      await service.record(context());

      expect(repository.append.mock.calls[0][0].requestId).toBe('trace-1');
    });

    it('serialises BigInt money, which a JSON column cannot hold', async () => {
      // Every price in this system is BigInt poysha; without this an audited price change
      // throws at write time.
      await service.record(
        context({ before: { pricePoysha: 125000n }, after: { pricePoysha: 99000n } }),
      );

      const written = repository.append.mock.calls[0][0];
      expect(written.before).toEqual({ pricePoysha: 125000 });
      expect(written.after).toEqual({ pricePoysha: 99000 });
    });

    it('stores an absent before/after as undefined rather than a null blob', async () => {
      await service.record(context());

      expect(repository.append.mock.calls[0][0].before).toBeUndefined();
      expect(repository.append.mock.calls[0][0].after).toBeUndefined();
    });

    it('records a missing actor email as null rather than dropping the entry', async () => {
      // AuthenticatedUser.email is mandatory; a phone-only account is '', not undefined.
      await service.record(
        context({
          actor: { userId: 'user-2', sessionId: 'session-1', email: '', role: UserRole.OPS },
        }),
      );

      expect(repository.append.mock.calls[0][0].actorEmail).toBeNull();
    });

    it('reports success', async () => {
      await expect(service.record(context())).resolves.toBe(true);
    });

    it('reports failure so the caller can refuse a money or permission write', async () => {
      repository.append.mockResolvedValue(false);

      await expect(service.record(context())).resolves.toBe(false);
    });

    it('logs loudly when the trail write failed — a silent gap is the one unacceptable failure', async () => {
      repository.append.mockResolvedValue(false);

      await service.record(context());

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product.published', entityId: 'product-1' }),
        'Audit trail write failed; the change it describes is NOT recorded',
      );
    });

    it('reports failure rather than throwing when the repository throws', async () => {
      repository.append.mockRejectedValue(new Error('unexpected'));

      await expect(service.record(context())).resolves.toBe(false);
    });
  });

  describe('listEntries', () => {
    it('returns the mapped page', async () => {
      repository.findPage.mockResolvedValue({ items: [auditEntryFixture()], total: 1 });

      const result = await service.listEntries(new AuditLogQueryDto());

      expect(result.ok && result.data.items[0].action).toBe('product.published');
      expect(result.ok && result.data.meta.totalItems).toBe(1);
    });

    it('returns an empty page rather than a 404 when nothing matches', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 0 });

      const result = await service.listEntries(new AuditLogQueryDto());

      expect(result.ok && result.data.items).toEqual([]);
    });

    it('answers 503 when the read failed', async () => {
      repository.findPage.mockResolvedValue(null);

      const result = await service.listEntries(new AuditLogQueryDto());

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('answers 500 and logs when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.findPage.mockRejectedValue(failure);

      const result = await service.listEntries(new AuditLogQueryDto());

      expect(!result.ok && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in AuditLogService.listEntries',
      );
    });
  });
});

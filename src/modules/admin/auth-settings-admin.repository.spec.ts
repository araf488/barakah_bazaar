import { PinoLogger } from 'nestjs-pino';
import { Prisma, UserRole } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuditLogRepository } from './audit-log.repository';
import { AuthSettingsAdminRepository } from './auth-settings-admin.repository';

const settings = {
  accessTokenMinutes: 30,
  customerRefreshIdleMinutes: 43200,
  customerRefreshAbsoluteMinutes: 129600,
  staffRefreshIdleMinutes: 720,
  staffRefreshAbsoluteMinutes: 10080,
  staffMfaRequired: true,
  emailVerificationGraceHours: 168,
  refreshReuseGraceSeconds: 30,
};

const expectedUpdatedAt = new Date('2026-10-01T00:00:00.000Z');
const writtenRow = {
  id: 'singleton',
  ...settings,
  updatedAt: new Date('2026-10-14T00:00:00.000Z'),
};

const auditRow = () => ({
  actorId: 'user-1',
  actorEmail: 'admin@barakahbazaar.com.bd',
  actorRole: UserRole.SUPER_ADMIN,
  action: 'auth.settings_updated',
  entityType: 'AuthSettings',
  entityId: 'singleton',
  before: undefined,
  after: undefined,
  requestId: null,
});

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });

describe('AuthSettingsAdminRepository', () => {
  let tx: {
    authSettings: {
      updateMany: jest.Mock;
      create: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    session: { updateMany: jest.Mock; findMany: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };
  let auditLog: { appendWithin: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: AuthSettingsAdminRepository;

  beforeEach(() => {
    tx = {
      authSettings: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(writtenRow),
        findUniqueOrThrow: jest.fn().mockResolvedValue(writtenRow),
      },
      session: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        findMany: jest.fn().mockResolvedValue([{ userId: 'staff-1' }, { userId: 'staff-2' }]),
      },
    };
    prisma = {
      $transaction: jest.fn((work: (client: unknown) => unknown) => work(tx)),
    };
    auditLog = { appendWithin: jest.fn() };
    logger = createMockLogger();
    repository = new AuthSettingsAdminRepository(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogRepository,
      logger,
    );
  });

  describe('writeAudited over an existing row', () => {
    it('updates only while the row still carries the updatedAt the caller read', async () => {
      await repository.writeAudited(settings, expectedUpdatedAt, auditRow);

      expect(tx.authSettings.updateMany).toHaveBeenCalledWith({
        where: { id: 'singleton', updatedAt: expectedUpdatedAt },
        data: settings,
      });
      expect(tx.authSettings.create).not.toHaveBeenCalled();
    });

    it('re-reads the written row and audits it inside the same transaction', async () => {
      const audit = jest.fn(auditRow);

      const result = await repository.writeAudited(settings, expectedUpdatedAt, audit);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.authSettings.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'singleton' },
      });
      expect(audit).toHaveBeenCalledWith(writtenRow, 0);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow());
      expect(result).toEqual({
        kind: 'written',
        row: writtenRow,
        revokedStaffSessions: 0,
        revokedStaffUserIds: [],
      });
    });

    it('reports a conflict, writes no audit row, and logs at info when someone wrote first', async () => {
      tx.authSettings.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.writeAudited(settings, expectedUpdatedAt, auditRow)).resolves.toEqual(
        { kind: 'conflict' },
      );
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Auth settings changed concurrently; write not applied',
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('writeAudited with no row yet', () => {
    it('creates the singleton row, then audits it in the same transaction', async () => {
      const result = await repository.writeAudited(settings, null, auditRow);

      expect(tx.authSettings.create).toHaveBeenCalledWith({
        data: { id: 'singleton', ...settings },
      });
      expect(tx.authSettings.updateMany).not.toHaveBeenCalled();
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow());
      expect(result).toEqual({
        kind: 'written',
        row: writtenRow,
        revokedStaffSessions: 0,
        revokedStaffUserIds: [],
      });
    });

    it('reports a conflict when another write created the row first', async () => {
      tx.authSettings.create.mockRejectedValue(uniqueViolation());

      await expect(repository.writeAudited(settings, null, auditRow)).resolves.toEqual({
        kind: 'conflict',
      });
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('writeAudited revoking staff sessions', () => {
    it('revokes every live non-customer session inside the same transaction and reports the count', async () => {
      const audit = jest.fn(auditRow);

      const result = await repository.writeAudited(settings, expectedUpdatedAt, audit, {
        revokeStaffSessions: true,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.session.updateMany).toHaveBeenCalledWith({
        where: { revokedAt: null, user: { role: { not: 'CUSTOMER' } } },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit).toHaveBeenCalledWith(writtenRow, 3);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow());
      expect(result).toEqual({
        kind: 'written',
        row: writtenRow,
        revokedStaffSessions: 3,
        revokedStaffUserIds: ['staff-1', 'staff-2'],
      });
    });

    it('selects the distinct owners of the live staff sessions inside the transaction, before revoking', async () => {
      const order: string[] = [];
      tx.session.findMany.mockImplementation(() => {
        order.push('select');
        return Promise.resolve([{ userId: 'staff-1' }]);
      });
      tx.session.updateMany.mockImplementation(() => {
        order.push('revoke');
        return Promise.resolve({ count: 2 });
      });

      await repository.writeAudited(settings, expectedUpdatedAt, auditRow, {
        revokeStaffSessions: true,
      });

      expect(tx.session.findMany).toHaveBeenCalledWith({
        where: { revokedAt: null, user: { role: { not: 'CUSTOMER' } } },
        select: { userId: true },
        distinct: ['userId'],
      });
      expect(order).toEqual(['select', 'revoke']);
    });

    it('revokes only after the guarded settings write matched', async () => {
      const order: string[] = [];
      tx.authSettings.updateMany.mockImplementation(() => {
        order.push('settings');
        return Promise.resolve({ count: 1 });
      });
      tx.session.updateMany.mockImplementation(() => {
        order.push('sessions');
        return Promise.resolve({ count: 1 });
      });

      await repository.writeAudited(settings, expectedUpdatedAt, auditRow, {
        revokeStaffSessions: true,
      });

      expect(order).toEqual(['settings', 'sessions']);
    });

    it('revokes nothing when the option is off or absent', async () => {
      await repository.writeAudited(settings, expectedUpdatedAt, auditRow, {
        revokeStaffSessions: false,
      });
      await repository.writeAudited(settings, expectedUpdatedAt, auditRow);

      expect(tx.session.updateMany).not.toHaveBeenCalled();
      expect(tx.session.findMany).not.toHaveBeenCalled();
    });

    it('revokes nothing on a conflict', async () => {
      tx.authSettings.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.writeAudited(settings, expectedUpdatedAt, auditRow, {
          revokeStaffSessions: true,
        }),
      ).resolves.toEqual({ kind: 'conflict' });
      expect(tx.session.updateMany).not.toHaveBeenCalled();
    });

    it('returns null when the revoke faults, so the settings write and audit roll back', async () => {
      tx.session.updateMany.mockRejectedValue(new Error('connection reset'));

      await expect(
        repository.writeAudited(settings, expectedUpdatedAt, auditRow, {
          revokeStaffSessions: true,
        }),
      ).resolves.toBeNull();
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Exception occurred in AuthSettingsAdminRepository.writeAudited',
      );
    });

    it('returns null when the audit write faults after a revoke, so the revoke rolls back too', async () => {
      auditLog.appendWithin.mockRejectedValue(new Error('audit down'));

      await expect(
        repository.writeAudited(settings, expectedUpdatedAt, auditRow, {
          revokeStaffSessions: true,
        }),
      ).resolves.toBeNull();
      expect(tx.session.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('faults', () => {
    it('returns null and logs when the write faults', async () => {
      tx.authSettings.updateMany.mockRejectedValue(new Error('connection reset'));

      await expect(
        repository.writeAudited(settings, expectedUpdatedAt, auditRow),
      ).resolves.toBeNull();
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Exception occurred in AuthSettingsAdminRepository.writeAudited',
      );
    });

    it('returns null when the audit write faults, so the transaction rolls back', async () => {
      auditLog.appendWithin.mockRejectedValue(new Error('audit down'));

      await expect(
        repository.writeAudited(settings, expectedUpdatedAt, auditRow),
      ).resolves.toBeNull();
    });

    it('treats a non-unique Prisma error on create as a fault, not a conflict', async () => {
      tx.authSettings.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }),
      );

      await expect(repository.writeAudited(settings, null, auditRow)).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

import { PinoLogger } from 'nestjs-pino';
import {
  Prisma,
  StaffInvitation,
  StaffInvitationStatus,
  User,
  UserRole,
} from '../../infra/prisma/prisma-client';
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
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    user: { create: jest.Mock };
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
        update: jest.fn().mockResolvedValue({ id: 'inv-1', acceptedBy: 'user-9' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      },
      user: {
        create: jest.fn().mockResolvedValue({ id: 'user-9' }),
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

  describe('acceptCreatingAccount', () => {
    const invitation = {
      id: 'inv-1',
      email: 'ops@barakahbazaar.com.bd',
      role: UserRole.OPS,
    } as StaffInvitation;
    const account = { passwordHash: 'scrypt$x', fullName: 'Rafiq Ahmed' };
    const audit = () => auditRow();

    it('closes the invitation, creates the verified account with the invited role, and audits it in one transaction', async () => {
      const auditFn = jest.fn(audit);

      const result = await repository.acceptCreatingAccount(invitation, account, auditFn);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.staffInvitation.updateMany).toHaveBeenCalledTimes(1);
      const claim = tx.staffInvitation.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({
        id: 'inv-1',
        status: StaffInvitationStatus.PENDING,
      });
      // The claim only locks and checks the row: the CHECK constraint forbids ACCEPTED without
      // acceptedBy, so the status must not move before the user exists.
      expect(claim.data).toEqual({ updatedAt: expect.any(Date) });
      expect(claim.data).not.toHaveProperty('status');
      const created = tx.user.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        email: 'ops@barakahbazaar.com.bd',
        role: UserRole.OPS,
        passwordHash: 'scrypt$x',
        fullName: 'Rafiq Ahmed',
        isActive: true,
      });
      expect(created.emailVerifiedAt).toBeInstanceOf(Date);
      // Status, acceptedAt and acceptedBy land together in ONE write, after the user exists.
      expect(tx.staffInvitation.update).toHaveBeenCalledTimes(1);
      expect(tx.staffInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          status: StaffInvitationStatus.ACCEPTED,
          acceptedAt: expect.any(Date),
          acceptedBy: 'user-9',
        },
      });
      // Claim first, then the user, then the single settling write.
      expect(tx.staffInvitation.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.user.create.mock.invocationCallOrder[0],
      );
      expect(tx.user.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.staffInvitation.update.mock.invocationCallOrder[0],
      );
      expect(auditFn).toHaveBeenCalledWith({ id: 'inv-1', acceptedBy: 'user-9' }, {
        id: 'user-9',
      } as User);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow());
      expect(result).toEqual({ kind: 'accepted', userId: 'user-9' });
    });

    it('creates nothing when another caller accepted it first', async () => {
      tx.staffInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.acceptCreatingAccount(invitation, account, audit)).resolves.toEqual({
        kind: 'not-pending',
      });

      expect(tx.user.create).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { invitationId: 'inv-1' },
        'Invitation was already settled by someone else',
      );
    });

    it('answers account-exists, rolling everything back, when the address already has an account', async () => {
      tx.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(repository.acceptCreatingAccount(invitation, account, audit)).resolves.toEqual({
        kind: 'account-exists',
      });

      expect(auditLog.appendWithin).not.toHaveBeenCalled();
      expect(tx.staffInvitation.update).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { invitationId: 'inv-1' },
        'Invitation accept found an existing account; nothing created',
      );
    });

    it('answers null on a fault and logs it', async () => {
      auditLog.appendWithin.mockRejectedValue(new Error('audit table gone'));

      await expect(
        repository.acceptCreatingAccount(invitation, account, audit),
      ).resolves.toBeNull();

      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), invitationId: 'inv-1' },
        'Exception occurred in StaffInvitationRepository.acceptCreatingAccount',
      );
    });

    it.each([
      ['not-pending', () => tx.staffInvitation.updateMany.mockResolvedValue({ count: 0 })],
      [
        'account-exists',
        () =>
          tx.user.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
          ),
      ],
      ['fault', () => auditLog.appendWithin.mockRejectedValue(new Error('audit table gone'))],
    ])('never logs the password hash on %s', async (_outcome, arrange) => {
      arrange();

      await repository.acceptCreatingAccount(invitation, account, audit);

      const logged = JSON.stringify([
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]);
      expect(logged).not.toContain('scrypt$x');
    });

    it('copies the invited role rather than hardcoding one', async () => {
      await repository.acceptCreatingAccount(
        { ...invitation, role: UserRole.WAREHOUSE },
        account,
        audit,
      );

      expect(tx.user.create.mock.calls[0][0].data.role).toBe(UserRole.WAREHOUSE);
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

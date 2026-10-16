import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PhoneLoginChallengeRepository } from './phone-login-challenge.repository';
import { PhoneLimits } from './phone-send-limits';

const limits: PhoneLimits = { cooldownSeconds: 60, perNumberDaily: 5, globalDaily: 500 };
const data = {
  userId: 'user-1',
  phone: '+8801712345678',
  codeHash: 'SECRET-HASH-VALUE',
  expiresAt: new Date('2026-10-16T12:05:00.000Z'),
  ipAddress: '203.0.113.0',
};

describe('PhoneLoginChallengeRepository', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    phoneLoginChallenge: { updateMany: jest.Mock; create: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    phoneLoginChallenge: Record<string, jest.Mock>;
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: PhoneLoginChallengeRepository;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ global_count: 0, number_count: 0, cooldown_remaining: 0 }]),
      phoneLoginChallenge: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn((work: (client: unknown) => unknown) => work(tx)),
      phoneLoginChallenge: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    logger = createMockLogger();
    repository = new PhoneLoginChallengeRepository(prisma as unknown as PrismaService, logger);
  });

  describe('issue', () => {
    it("retires only this user's live challenges, then creates, in one transaction", async () => {
      expect(await repository.issue(data, limits)).toEqual({ kind: 'issued' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.phoneLoginChallenge.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(tx.phoneLoginChallenge.create).toHaveBeenCalledWith({ data });
    });

    it('creates nothing when a limit refuses', async () => {
      tx.$queryRaw.mockResolvedValue([{ global_count: 0, number_count: 5, cooldown_remaining: 0 }]);

      expect(await repository.issue(data, limits)).toEqual({ kind: 'number-limit' });
      expect(tx.phoneLoginChallenge.updateMany).not.toHaveBeenCalled();
      expect(tx.phoneLoginChallenge.create).not.toHaveBeenCalled();
    });

    it('returns null on a fault and never logs the code hash', async () => {
      prisma.$transaction.mockRejectedValue(new Error('down'));

      expect(await repository.issue(data, limits)).toBeNull();
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('SECRET-HASH-VALUE');
    });
  });

  describe('findNewestLiveForPhone', () => {
    it('filters by phone and unconsumed, newest first, with the user', async () => {
      prisma.phoneLoginChallenge.findFirst.mockResolvedValue({ id: 'c1' });

      expect(await repository.findNewestLiveForPhone(data.phone)).toEqual({ id: 'c1' });
      expect(prisma.phoneLoginChallenge.findFirst).toHaveBeenCalledWith({
        where: { phone: '+8801712345678', consumedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      });
    });

    it('is undefined with no row and null on a fault', async () => {
      prisma.phoneLoginChallenge.findFirst.mockResolvedValueOnce(null);
      expect(await repository.findNewestLiveForPhone('p')).toBeUndefined();

      prisma.phoneLoginChallenge.findFirst.mockRejectedValueOnce(new Error('down'));
      expect(await repository.findNewestLiveForPhone('p')).toBeNull();
    });
  });

  describe('claimAttempt', () => {
    it('claims a slot only on an unspent code under the cap', async () => {
      prisma.phoneLoginChallenge.updateMany.mockResolvedValue({ count: 1 });

      expect(await repository.claimAttempt('c1')).toBe(true);
      expect(prisma.phoneLoginChallenge.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', consumedAt: null, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
    });

    it('is false when no slot was left', async () => {
      prisma.phoneLoginChallenge.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.claimAttempt('c1')).toBe(false);
    });

    it('returns null on a fault', async () => {
      prisma.phoneLoginChallenge.updateMany.mockRejectedValue(new Error('down'));

      expect(await repository.claimAttempt('c1')).toBeNull();
    });
  });

  describe('consume', () => {
    it('is true when this call spent the challenge', async () => {
      prisma.phoneLoginChallenge.updateMany.mockResolvedValue({ count: 1 });

      expect(await repository.consume('c1')).toBe(true);
      expect(prisma.phoneLoginChallenge.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('is false when it was already spent', async () => {
      prisma.phoneLoginChallenge.updateMany.mockResolvedValue({ count: 0 });
      expect(await repository.consume('c1')).toBe(false);
    });

    it('is null on a fault', async () => {
      prisma.phoneLoginChallenge.updateMany.mockRejectedValue(new Error('down'));
      expect(await repository.consume('c1')).toBeNull();
    });
  });

  describe('deleteStale', () => {
    it('deletes only consumed or expired rows older than the cutoff', async () => {
      prisma.phoneLoginChallenge.deleteMany.mockResolvedValue({ count: 2 });
      const before = new Date('2026-09-16T00:00:00.000Z');

      expect(await repository.deleteStale(before)).toBe(2);
      expect(prisma.phoneLoginChallenge.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: before },
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: expect.any(Date) } }],
        },
      });
    });

    it('returns null on a fault', async () => {
      prisma.phoneLoginChallenge.deleteMany.mockRejectedValue(new Error('down'));
      expect(await repository.deleteStale(new Date())).toBeNull();
    });
  });

  describe('globalLimitReached', () => {
    it('is true at the ceiling and false under it', async () => {
      prisma.$queryRaw.mockResolvedValue([{ global_count: 500 }]);
      expect(await repository.globalLimitReached(500)).toBe(true);

      prisma.$queryRaw.mockResolvedValue([{ global_count: 499 }]);
      expect(await repository.globalLimitReached(500)).toBe(false);
    });

    it('pins the SQL: both tables, 24h window on the database clock', async () => {
      prisma.$queryRaw.mockResolvedValue([{ global_count: 0 }]);
      await repository.globalLimitReached(500);

      const query = (prisma.$queryRaw.mock.calls[0] as [string[]])[0].join('?');
      expect(query).toContain('FROM phone_verifications WHERE created_at > now() - interval');
      expect(query).toContain('FROM phone_login_challenges WHERE created_at > now() - interval');
      expect(query.split("now() - interval '24 hours'")).toHaveLength(3);
      expect(query).toContain('UNION ALL');
      expect(query).toContain('count(*)::int AS global_count');
    });

    it('is null on a fault, logging it', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('down'));

      expect(await repository.globalLimitReached(500)).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Exception occurred in PhoneLoginChallengeRepository.globalLimitReached',
      );
    });
  });
});

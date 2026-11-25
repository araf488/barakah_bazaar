import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { Prisma } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { SessionCachePort } from '../sessions/session-cache.port';
import { PhoneLimits } from './phone-send-limits';
import { PhoneVerificationRepository } from './phone-verification.repository';

const limits: PhoneLimits = { cooldownSeconds: 60, perNumberDaily: 5, globalDaily: 500 };
const data = {
  userId: 'user-1',
  phone: '+8801712345678',
  codeHash: 'SECRET-HASH-VALUE',
  expiresAt: new Date('2026-10-16T12:05:00.000Z'),
};
const ACCOUNT_DAILY_LIMIT = 5;
const sqlOf = (call: unknown[]): string => (call[0] as string[]).join('?');
const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });

describe('PhoneVerificationRepository', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    phoneVerification: { updateMany: jest.Mock; create: jest.Mock };
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    phoneVerification: Record<string, jest.Mock>;
  };
  let sessionCache: { invalidateUser: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: PhoneVerificationRepository;
  let sendCounts: unknown[];
  let accountCount: number;

  beforeEach(() => {
    sendCounts = [{ global_count: 0, number_count: 0, cooldown_remaining: 0 }];
    accountCount = 0;
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      // Answers by which query it is handed, so the per-number limits and the per-account count
      // can be told apart: each reads its own row, as against real Postgres.
      $queryRaw: jest.fn((strings: TemplateStringsArray) =>
        Promise.resolve(
          strings.join('?').includes('account_count')
            ? [{ account_count: accountCount }]
            : sendCounts,
        ),
      ),
      phoneVerification: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ fullName: 'Aisha Rahman' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      $transaction: jest.fn((work: (client: unknown) => unknown) => work(tx)),
      $queryRaw: jest.fn().mockResolvedValue([{ account_count: 0 }]),
      phoneVerification: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    sessionCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    repository = new PhoneVerificationRepository(
      prisma as unknown as PrismaService,
      sessionCache as unknown as SessionCachePort,
      logger,
    );
  });

  describe('accountLimitReached', () => {
    it('is false under the limit and true at it, comparing against the limit it is given', async () => {
      prisma.$queryRaw.mockResolvedValue([{ account_count: 4 }]);
      expect(await repository.accountLimitReached('user-1', 5)).toBe(false);
      expect(await repository.accountLimitReached('user-1', 4)).toBe(true);
    });

    it('is false when the count query returns no row', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      expect(await repository.accountLimitReached('user-1', 5)).toBe(false);
    });

    it('pins the SQL: a lock-free 24 h count on the database clock, outside any transaction', async () => {
      await repository.accountLimitReached('user-1', 5);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      const call = prisma.$queryRaw.mock.calls[0] as unknown[];
      expect(sqlOf(call).replace(/\s+/g, ' ').trim()).toBe(
        'SELECT count(*)::int AS account_count FROM phone_verifications ' +
          "WHERE user_id = ?::uuid AND created_at > now() - interval '24 hours'",
      );
      expect(call.slice(1)).toEqual(['user-1']);
    });

    it('returns null on a fault and logs it', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('down'));

      expect(await repository.accountLimitReached('user-1', 5)).toBeNull();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('issue', () => {
    it("retires only this user's live codes, then creates, inside one transaction", async () => {
      const result = await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT);

      expect(result).toEqual({ kind: 'issued' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.phoneVerification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(tx.phoneVerification.create).toHaveBeenCalledWith({ data });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.phoneVerification.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.phoneVerification.create.mock.invocationCallOrder[0],
      );
    });

    it('creates nothing when a limit refuses', async () => {
      sendCounts = [{ global_count: 0, number_count: 0, cooldown_remaining: 20 }];

      expect(await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT)).toEqual({
        kind: 'cooldown',
        retryAfterSeconds: 20,
      });
      expect(tx.phoneVerification.updateMany).not.toHaveBeenCalled();
      expect(tx.phoneVerification.create).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('never writes the number to the account, whatever the verdict', async () => {
      await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT);
      sendCounts = [{ global_count: 0, number_count: 5, cooldown_remaining: 0 }];
      await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT);
      sendCounts = [{ global_count: 0, number_count: 0, cooldown_remaining: 0 }];
      accountCount = ACCOUNT_DAILY_LIMIT;
      await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT);

      expect(tx.user.update).not.toHaveBeenCalled();
    });

    describe('per-account daily limit', () => {
      it('answers account-limit at the cap, retiring and storing nothing', async () => {
        accountCount = 5;

        expect(await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT)).toEqual({
          kind: 'account-limit',
        });
        expect(tx.phoneVerification.updateMany).not.toHaveBeenCalled();
        expect(tx.phoneVerification.create).not.toHaveBeenCalled();
      });

      it('answers account-limit over the cap too', async () => {
        accountCount = 9;

        expect(await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT)).toEqual({
          kind: 'account-limit',
        });
      });

      it('issues one under the cap', async () => {
        accountCount = 4;

        expect(await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT)).toEqual({
          kind: 'issued',
        });
        expect(tx.phoneVerification.create).toHaveBeenCalledWith({ data });
      });

      it('compares against the limit it is given, not a fixed number', async () => {
        accountCount = 2;

        expect(await repository.issue(data, limits, 2)).toEqual({ kind: 'account-limit' });
      });

      it('pins the SQL: a lock on the user id, then the 24 h count on the database clock', async () => {
        await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT);

        expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
        const userLock = tx.$executeRaw.mock.calls[1] as unknown[];
        expect(sqlOf(userLock)).toBe('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))');
        expect(userLock.slice(1)).toEqual(['user-1']);

        const countCall = tx.$queryRaw.mock.calls.find((call) =>
          sqlOf(call as unknown[]).includes('account_count'),
        ) as unknown[];
        expect(sqlOf(countCall).replace(/\s+/g, ' ').trim()).toBe(
          'SELECT count(*)::int AS account_count FROM phone_verifications ' +
            "WHERE user_id = ?::uuid AND created_at > now() - interval '24 hours'",
        );
        expect(countCall.slice(1)).toEqual(['user-1']);
      });

      it('takes the per-number lock, then the account lock, then counts the account', async () => {
        await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT);

        const [numberLock, accountLock] = tx.$executeRaw.mock.invocationCallOrder;
        const accountCountOrder = tx.$queryRaw.mock.invocationCallOrder[1];
        expect((tx.$executeRaw.mock.calls[0] as unknown[])[1]).toBe('+8801712345678');
        expect(numberLock).toBeLessThan(accountLock);
        expect(accountLock).toBeLessThan(accountCountOrder);
        expect(accountCountOrder).toBeLessThan(
          tx.phoneVerification.create.mock.invocationCallOrder[0],
        );
      });

      it('does not count the account when a per-number limit already refused', async () => {
        sendCounts = [{ global_count: 0, number_count: 5, cooldown_remaining: 0 }];

        expect(await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT)).toEqual({
          kind: 'number-limit',
        });
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      });
    });

    it('returns null on a fault and never logs the code hash', async () => {
      prisma.$transaction.mockRejectedValue(new Error('down'));

      expect(await repository.issue(data, limits, ACCOUNT_DAILY_LIMIT)).toBeNull();
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('SECRET-HASH-VALUE');
    });
  });

  describe('findNewestLive', () => {
    it('filters by user, phone and unconsumed, newest first', async () => {
      prisma.phoneVerification.findFirst.mockResolvedValue({ id: 'v1' });

      expect(await repository.findNewestLive('user-1', data.phone)).toEqual({ id: 'v1' });
      expect(prisma.phoneVerification.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', phone: '+8801712345678', consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('is undefined with no row and null on a fault', async () => {
      prisma.phoneVerification.findFirst.mockResolvedValueOnce(null);
      expect(await repository.findNewestLive('u', 'p')).toBeUndefined();

      prisma.phoneVerification.findFirst.mockRejectedValueOnce(new Error('down'));
      expect(await repository.findNewestLive('u', 'p')).toBeNull();
    });
  });

  describe('claimAttempt', () => {
    it('claims a slot only on an unspent code under the cap', async () => {
      prisma.phoneVerification.updateMany.mockResolvedValue({ count: 1 });

      expect(await repository.claimAttempt('v1')).toBe(true);
      expect(prisma.phoneVerification.updateMany).toHaveBeenCalledWith({
        where: { id: 'v1', consumedAt: null, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
    });

    it('is false when no slot was left', async () => {
      prisma.phoneVerification.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.claimAttempt('v1')).toBe(false);
    });

    it('returns null on a fault', async () => {
      prisma.phoneVerification.updateMany.mockRejectedValue(new Error('down'));

      expect(await repository.claimAttempt('v1')).toBeNull();
    });
  });

  describe('confirm', () => {
    it("spends the code, writes the number and returns the account's name", async () => {
      const result = await repository.confirm('v1', 'user-1', data.phone);

      expect(result).toEqual({ kind: 'confirmed', fullName: 'Aisha Rahman' });
      expect(tx.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { fullName: true },
      });
      expect(tx.phoneVerification.updateMany).toHaveBeenCalledWith({
        where: { id: 'v1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { phone: '+8801712345678', phoneVerifiedAt: expect.any(Date) },
      });
    });

    it('reports a null fullName for an account without a name', async () => {
      tx.user.findUnique.mockResolvedValue({ fullName: null });

      expect(await repository.confirm('v1', 'user-1', data.phone)).toEqual({
        kind: 'confirmed',
        fullName: null,
      });
    });

    it('reads the user once, inside the transaction, with no extra query', async () => {
      await repository.confirm('v1', 'user-1', data.phone);

      expect(tx.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('answers already-used when the code was spent first, and writes no user', async () => {
      tx.phoneVerification.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.confirm('v1', 'user-1', data.phone)).toEqual({
        kind: 'already-used',
      });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('answers phone-in-use on a unique violation, logged at info', async () => {
      tx.user.update.mockRejectedValue(uniqueViolation());

      expect(await repository.confirm('v1', 'user-1', data.phone)).toEqual({
        kind: 'phone-in-use',
      });
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('returns null on any other fault', async () => {
      tx.user.update.mockRejectedValue(new Error('down'));

      expect(await repository.confirm('v1', 'user-1', data.phone)).toBeNull();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('invalidates the session cache only after the transaction commits', async () => {
      await repository.confirm('v1', 'user-1', data.phone);

      expect(sessionCache.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(sessionCache.invalidateUser.mock.invocationCallOrder[0]).toBeGreaterThan(
        tx.user.update.mock.invocationCallOrder[0],
      );
    });

    it('still returns confirmed when cache invalidation rejects', async () => {
      sessionCache.invalidateUser.mockRejectedValue(new Error('redis'));

      expect(await repository.confirm('v1', 'user-1', data.phone)).toEqual({
        kind: 'confirmed',
        fullName: 'Aisha Rahman',
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteStale', () => {
    it('deletes only consumed or expired rows older than the cutoff', async () => {
      prisma.phoneVerification.deleteMany.mockResolvedValue({ count: 4 });
      const before = new Date('2026-09-16T00:00:00.000Z');

      expect(await repository.deleteStale(before)).toBe(4);
      expect(prisma.phoneVerification.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: before },
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: expect.any(Date) } }],
        },
      });
    });

    it('returns null on a fault', async () => {
      prisma.phoneVerification.deleteMany.mockRejectedValue(new Error('down'));
      expect(await repository.deleteStale(new Date())).toBeNull();
    });
  });
});

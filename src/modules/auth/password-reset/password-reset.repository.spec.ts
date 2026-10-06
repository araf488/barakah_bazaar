import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PasswordResetRepository } from './password-reset.repository';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-1',
  userId: 'user-1',
  email: 'shopper@example.com',
  tokenHash: 'token-hash',
  codeHash: 'code-hash',
  expiresAt: new Date('2026-10-05T01:00:00.000Z'),
  attempts: 0,
  consumedAt: null,
  createdAt: new Date('2026-10-05T00:00:00.000Z'),
  ...overrides,
});

const newReset = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  email: 'shopper@example.com',
  tokenHash: 'token-hash',
  codeHash: 'code-hash',
  expiresAt: new Date('2026-10-05T01:00:00.000Z'),
  ...overrides,
});

describe('PasswordResetRepository', () => {
  let prisma: { passwordReset: Record<string, jest.Mock> };
  let logger: jest.Mocked<PinoLogger>;
  let repository: PasswordResetRepository;

  beforeEach(() => {
    prisma = {
      passwordReset: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    logger = createMockLogger();
    repository = new PasswordResetRepository(prisma as unknown as PrismaService, logger);
  });

  describe('create', () => {
    it('lowercases the address, so one address cannot hold two records by case', async () => {
      prisma.passwordReset.create.mockResolvedValue(row());

      await repository.create(newReset({ email: 'Shopper@Example.COM' }));

      expect(prisma.passwordReset.create.mock.calls[0][0].data.email).toBe('shopper@example.com');
    });

    it('reports null when the write fails, so the caller does not email a credential it never stored', async () => {
      prisma.passwordReset.create.mockRejectedValue(new Error('boom'));

      await expect(repository.create(newReset())).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('never logs the token hash or code hash it was given', async () => {
      prisma.passwordReset.create.mockRejectedValue(new Error('boom'));

      await repository.create(
        newReset({ tokenHash: 'secret-token-hash', codeHash: 'secret-code-hash' }),
      );

      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain('secret-token-hash');
      expect(logged).not.toContain('secret-code-hash');
    });
  });

  describe('findByTokenHash', () => {
    it('returns the row with its user', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue(row());

      await expect(repository.findByTokenHash('token-hash')).resolves.toEqual(row());
      expect(prisma.passwordReset.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'token-hash' },
        include: { user: true },
      });
    });

    it('returns undefined for no such token, and null for a database fault', async () => {
      prisma.passwordReset.findUnique.mockResolvedValueOnce(null);
      await expect(repository.findByTokenHash('token-hash')).resolves.toBeUndefined();

      prisma.passwordReset.findUnique.mockRejectedValueOnce(new Error('boom'));
      await expect(repository.findByTokenHash('token-hash')).resolves.toBeNull();
    });

    it('never logs the token hash it was given', async () => {
      prisma.passwordReset.findUnique.mockRejectedValue(new Error('boom'));

      await repository.findByTokenHash('secret-token-hash');

      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-token-hash');
    });
  });

  describe('findNewestLiveForEmail', () => {
    it('asks for the newest unconsumed row for that address, lower-cased', async () => {
      prisma.passwordReset.findFirst.mockResolvedValue(row());

      await repository.findNewestLiveForEmail('Shopper@Example.COM');

      expect(prisma.passwordReset.findFirst).toHaveBeenCalledWith({
        where: { email: 'shopper@example.com', consumedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      });
    });

    it('returns undefined when there is no live row for that address', async () => {
      prisma.passwordReset.findFirst.mockResolvedValue(null);

      await expect(
        repository.findNewestLiveForEmail('shopper@example.com'),
      ).resolves.toBeUndefined();
    });

    it('returns null — distinct from undefined — when the database fails', async () => {
      prisma.passwordReset.findFirst.mockRejectedValue(new Error('boom'));

      await expect(repository.findNewestLiveForEmail('shopper@example.com')).resolves.toBeNull();
    });
  });

  describe('incrementAttempts', () => {
    it('issues an atomic increment rather than a computed literal, and returns the new count', async () => {
      prisma.passwordReset.update.mockResolvedValue(row({ attempts: 3 }));

      await expect(repository.incrementAttempts('pr-1')).resolves.toBe(3);
      expect(prisma.passwordReset.update).toHaveBeenCalledWith({
        where: { id: 'pr-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('reports null rather than throwing when the write fails, so the caller can fail closed', async () => {
      prisma.passwordReset.update.mockRejectedValue(new Error('boom'));

      await expect(repository.incrementAttempts('pr-1')).resolves.toBeNull();
    });
  });

  describe('claim', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-05T00:10:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('stamps only a live, unexpired record and returns the stamp it wrote', async () => {
      prisma.passwordReset.updateMany.mockResolvedValue({ count: 1 });

      await expect(repository.claim('pr-1')).resolves.toEqual(new Date('2026-10-05T00:10:00.000Z'));
      expect(prisma.passwordReset.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pr-1',
          consumedAt: null,
          expiresAt: { gt: new Date('2026-10-05T00:10:00.000Z') },
        },
        data: { consumedAt: new Date('2026-10-05T00:10:00.000Z') },
      });
    });

    it('reports undefined when another redemption already took the record', async () => {
      prisma.passwordReset.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.claim('pr-1')).resolves.toBeUndefined();
    });

    it('reports null, logged, when the write failed', async () => {
      prisma.passwordReset.updateMany.mockRejectedValue(new Error('boom'));

      await expect(repository.claim('pr-1')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('reopens only the record still carrying this claim stamp', async () => {
      prisma.passwordReset.updateMany.mockResolvedValue({ count: 1 });
      const claimedAt = new Date('2026-10-05T00:10:00.000Z');

      await expect(repository.release('pr-1', claimedAt)).resolves.toBe(1);
      expect(prisma.passwordReset.updateMany).toHaveBeenCalledWith({
        where: { id: 'pr-1', consumedAt: new Date('2026-10-05T00:10:00.000Z') },
        data: { consumedAt: null },
      });
    });

    it('reports null, logged, when the write failed', async () => {
      prisma.passwordReset.updateMany.mockRejectedValue(new Error('boom'));

      await expect(repository.release('pr-1', new Date())).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('consumeAllForUser', () => {
    it('closes every live record for the account and reports how many', async () => {
      prisma.passwordReset.updateMany.mockResolvedValue({ count: 2 });

      await expect(repository.consumeAllForUser('user-1')).resolves.toBe(2);
      expect(prisma.passwordReset.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        consumedAt: null,
      });
    });

    it('reports null rather than a cheerful zero when the write failed', async () => {
      prisma.passwordReset.updateMany.mockRejectedValue(new Error('boom'));

      await expect(repository.consumeAllForUser('user-1')).resolves.toBeNull();
    });
  });

  describe('deleteStale', () => {
    it('removes only rows that are finished and older than the cutoff', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
      prisma.passwordReset.deleteMany.mockResolvedValue({ count: 4 });
      const cutoff = new Date('2026-09-05T00:00:00.000Z');

      await expect(repository.deleteStale(cutoff)).resolves.toBe(4);
      expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: cutoff },
          OR: [
            { consumedAt: { not: null } },
            { expiresAt: { lt: new Date('2026-10-05T00:00:00.000Z') } },
          ],
        },
      });
      jest.useRealTimers();
    });

    it('reports null rather than a cheerful zero when the delete failed', async () => {
      prisma.passwordReset.deleteMany.mockRejectedValue(new Error('boom'));

      await expect(repository.deleteStale(new Date())).resolves.toBeNull();
    });
  });
});

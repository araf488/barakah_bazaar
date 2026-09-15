import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { EmailVerificationRepository } from './email-verification.repository';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  userId: 'user-1',
  email: 'shopper@example.com',
  tokenHash: 'token-hash',
  codeHash: 'code-hash',
  expiresAt: new Date('2026-09-15T00:00:00.000Z'),
  attempts: 0,
  consumedAt: null,
  createdAt: new Date('2026-09-14T00:00:00.000Z'),
  ...overrides,
});

describe('EmailVerificationRepository', () => {
  let prisma: { emailVerification: Record<string, jest.Mock> };
  let logger: jest.Mocked<PinoLogger>;
  let repository: EmailVerificationRepository;

  beforeEach(() => {
    prisma = {
      emailVerification: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    logger = createMockLogger();
    repository = new EmailVerificationRepository(prisma as unknown as PrismaService, logger);
  });

  describe('create', () => {
    it('lowercases the address, so one address cannot hold two records by case', async () => {
      prisma.emailVerification.create.mockResolvedValue(row());

      await repository.create({
        userId: 'user-1',
        email: 'Shopper@Example.COM',
        tokenHash: 'token-hash',
        codeHash: 'code-hash',
        expiresAt: new Date('2026-09-15T00:00:00.000Z'),
      });

      expect(prisma.emailVerification.create.mock.calls[0][0].data.email).toBe(
        'shopper@example.com',
      );
    });

    it('reports null when the write fails, so the caller does not email a credential it never stored', async () => {
      prisma.emailVerification.create.mockRejectedValue(new Error('boom'));

      await expect(
        repository.create({
          userId: 'user-1',
          email: 'shopper@example.com',
          tokenHash: 'token-hash',
          codeHash: 'code-hash',
          expiresAt: new Date(),
        }),
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('never logs the token hash or code hash it was given', async () => {
      prisma.emailVerification.create.mockRejectedValue(new Error('boom'));

      await repository.create({
        userId: 'user-1',
        email: 'shopper@example.com',
        tokenHash: 'secret-token-hash',
        codeHash: 'secret-code-hash',
        expiresAt: new Date(),
      });

      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain('secret-token-hash');
      expect(logged).not.toContain('secret-code-hash');
    });
  });

  describe('findByTokenHash', () => {
    it('returns the row with its user', async () => {
      prisma.emailVerification.findUnique.mockResolvedValue({ ...row(), user: { id: 'user-1' } });

      await expect(repository.findByTokenHash('token-hash')).resolves.toMatchObject({
        id: 'ev-1',
      });
    });

    it('returns undefined for no such token, and null for a database fault', async () => {
      prisma.emailVerification.findUnique.mockResolvedValue(null);
      await expect(repository.findByTokenHash('nope')).resolves.toBeUndefined();

      prisma.emailVerification.findUnique.mockRejectedValue(new Error('boom'));
      await expect(repository.findByTokenHash('nope')).resolves.toBeNull();
    });

    it('never logs the token hash it was given', async () => {
      prisma.emailVerification.findUnique.mockRejectedValue(new Error('boom'));

      await repository.findByTokenHash('secret-token-hash');

      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-token-hash');
    });
  });

  describe('findNewestLiveForEmail', () => {
    it('asks for the newest unconsumed row for that address', async () => {
      prisma.emailVerification.findFirst.mockResolvedValue({ ...row(), user: { id: 'user-1' } });

      await repository.findNewestLiveForEmail('Shopper@Example.COM');

      const args = prisma.emailVerification.findFirst.mock.calls[0][0];
      expect(args.where).toMatchObject({ email: 'shopper@example.com', consumedAt: null });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('returns undefined when there is no live row for that address', async () => {
      prisma.emailVerification.findFirst.mockResolvedValue(null);

      await expect(
        repository.findNewestLiveForEmail('shopper@example.com'),
      ).resolves.toBeUndefined();
    });

    it('returns null — distinct from undefined — when the database fails', async () => {
      prisma.emailVerification.findFirst.mockRejectedValue(new Error('boom'));

      await expect(repository.findNewestLiveForEmail('shopper@example.com')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('consumeAllForUser', () => {
    it('reports how many live records it closed', async () => {
      prisma.emailVerification.updateMany.mockResolvedValue({ count: 2 });

      await expect(repository.consumeAllForUser('user-1')).resolves.toBe(2);
      expect(prisma.emailVerification.updateMany.mock.calls[0][0].where).toMatchObject({
        userId: 'user-1',
        consumedAt: null,
      });
    });

    it('reports null rather than a cheerful zero when the write failed', async () => {
      prisma.emailVerification.updateMany.mockRejectedValue(new Error('boom'));

      await expect(repository.consumeAllForUser('user-1')).resolves.toBeNull();
    });
  });

  describe('incrementAttempts', () => {
    it('issues an atomic increment rather than a computed literal, and returns the new count', async () => {
      prisma.emailVerification.update.mockResolvedValue(row({ attempts: 4 }));

      await expect(repository.incrementAttempts('ev-1')).resolves.toBe(4);
      expect(prisma.emailVerification.update).toHaveBeenCalledWith({
        where: { id: 'ev-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('reports null rather than throwing when the write fails, so the caller can fail closed', async () => {
      prisma.emailVerification.update.mockRejectedValue(new Error('boom'));

      await expect(repository.incrementAttempts('ev-1')).resolves.toBeNull();
    });
  });

  describe('deleteStale', () => {
    it('removes only rows that are finished and older than the cutoff', async () => {
      prisma.emailVerification.deleteMany.mockResolvedValue({ count: 4 });
      const cutoff = new Date('2026-08-15T00:00:00.000Z');

      await expect(repository.deleteStale(cutoff)).resolves.toBe(4);

      const where = prisma.emailVerification.deleteMany.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({ lt: cutoff });
      expect(where.OR).toEqual([
        { consumedAt: { not: null } },
        { expiresAt: { lt: expect.any(Date) } },
      ]);
    });

    it('reports null rather than a cheerful zero when the delete failed', async () => {
      prisma.emailVerification.deleteMany.mockRejectedValue(new Error('boom'));

      await expect(
        repository.deleteStale(new Date('2026-08-15T00:00:00.000Z')),
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

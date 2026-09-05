import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthRepository } from './auth.repository';
import { SessionCachePort } from './sessions/session-cache.port';

describe('AuthRepository', () => {
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    mfaRecoveryCode: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let sessionCache: { invalidateUser: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: AuthRepository;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      mfaRecoveryCode: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    sessionCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    repository = new AuthRepository(
      prisma as unknown as PrismaService,
      sessionCache as unknown as SessionCachePort,
      logger,
    );
  });

  describe('findById', () => {
    it('returns the matching user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(repository.findById('user-1')).resolves.toEqual({ id: 'user-1' });
    });

    it('looks the row up by its own id', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await repository.findById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('returns undefined when no user matches', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(repository.findById('user-1')).resolves.toBeUndefined();
    });

    it('returns null — distinct from undefined — when the database fails', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findById('user-1')).resolves.toBeNull();
    });

    it('logs the failure with the exception object', async () => {
      const failure = new Error('connection refused');
      prisma.user.findUnique.mockRejectedValue(failure);

      await repository.findById('user-1');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure, userId: 'user-1' }),
        'Exception occurred in AuthRepository.findById',
      );
    });
  });

  describe('findByEmail', () => {
    it('returns the matching user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });

      await expect(repository.findByEmail('ops@barakahbazaar.com.bd')).resolves.toEqual({
        id: 'user-1',
      });
    });

    it('matches case-insensitively', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });

      await repository.findByEmail('OPS@BarakahBazaar.com.bd');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'OPS@BarakahBazaar.com.bd', mode: 'insensitive' } },
      });
    });

    it('returns undefined when no user matches', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(repository.findByEmail('nobody@example.com')).resolves.toBeUndefined();
    });

    it('returns null — distinct from undefined — when the database fails', async () => {
      prisma.user.findFirst.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findByEmail('ops@barakahbazaar.com.bd')).resolves.toBeNull();
    });

    it('logs the failure with the exception object', async () => {
      const failure = new Error('connection refused');
      prisma.user.findFirst.mockRejectedValue(failure);

      await repository.findByEmail('ops@barakahbazaar.com.bd');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in AuthRepository.findByEmail',
      );
    });
  });

  describe('updatePasswordHash', () => {
    it('writes the new hash and stamps passwordChangedAt', async () => {
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
      prisma.user.update.mockResolvedValue({ id: 'user-1', passwordHash: 'scrypt$new' });

      await repository.updatePasswordHash('user-1', 'scrypt$new');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
        data: { passwordHash: 'scrypt$new', passwordChangedAt: expect.any(Date) },
      });
    });

    it('returns null when the write fails', async () => {
      prisma.user.update.mockRejectedValue(new Error('connection refused'));

      await expect(repository.updatePasswordHash('user-1', 'scrypt$new')).resolves.toBeNull();
    });

    it('bumps the session-cache generation after the write commits', async () => {
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
      prisma.user.update.mockResolvedValue({ id: 'user-1', passwordHash: 'scrypt$new' });

      await repository.updatePasswordHash('user-1', 'scrypt$new');

      expect(sessionCache.invalidateUser).toHaveBeenCalledWith('user-1');
    });

    it('does not bump the cache when the write fails', async () => {
      prisma.user.update.mockRejectedValue(new Error('connection refused'));

      await repository.updatePasswordHash('user-1', 'scrypt$new');

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('saveTotpSecret', () => {
    it('stores the encrypted secret', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await repository.saveTotpSecret('user-1', 'sealed');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpSecretEncrypted: 'sealed' },
      });
    });

    it('returns null when the write fails', async () => {
      prisma.user.update.mockRejectedValue(new Error('connection refused'));

      await expect(repository.saveTotpSecret('user-1', 'sealed')).resolves.toBeNull();
    });

    it('does not bump the session-cache generation — an unconfirmed secret ends no session', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await repository.saveTotpSecret('user-1', 'sealed');

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('enableTotp', () => {
    it('deletes old recovery codes, writes the new hashes, and stamps totpEnabledAt', async () => {
      const user = { id: 'user-1', totpEnabledAt: new Date() };
      prisma.$transaction.mockImplementation(
        async (operations: unknown[]) => await Promise.all(operations),
      );
      prisma.mfaRecoveryCode.deleteMany.mockResolvedValue({ count: 0 });
      prisma.mfaRecoveryCode.createMany.mockResolvedValue({ count: 2 });
      prisma.user.update.mockResolvedValue(user);

      await expect(repository.enableTotp('user-1', 5, ['hash-a', 'hash-b'])).resolves.toEqual(user);
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.mfaRecoveryCode.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'user-1', codeHash: 'hash-a' },
          { userId: 'user-1', codeHash: 'hash-b' },
        ],
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          totpEnabledAt: expect.any(Date),
          totpLastUsedStep: 5,
          totpFailedAttempts: 0,
          totpLockedUntil: null,
        },
      });
    });

    it('returns null when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection refused'));

      await expect(repository.enableTotp('user-1', 5, ['hash-a'])).resolves.toBeNull();
    });

    it('does not bump the session-cache generation — enrolling MFA ends no other session', async () => {
      const user = { id: 'user-1', totpEnabledAt: new Date() };
      prisma.$transaction.mockImplementation(
        async (operations: unknown[]) => await Promise.all(operations),
      );
      prisma.mfaRecoveryCode.deleteMany.mockResolvedValue({ count: 0 });
      prisma.mfaRecoveryCode.createMany.mockResolvedValue({ count: 2 });
      prisma.user.update.mockResolvedValue(user);

      await repository.enableTotp('user-1', 5, ['hash-a']);

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('disableTotp', () => {
    it('clears the secret and every recovery code in one transaction', async () => {
      const user = { id: 'user-1', totpEnabledAt: null };
      prisma.$transaction.mockImplementation(
        async (operations: unknown[]) => await Promise.all(operations),
      );
      prisma.mfaRecoveryCode.deleteMany.mockResolvedValue({ count: 3 });
      prisma.user.update.mockResolvedValue(user);

      await expect(repository.disableTotp('user-1')).resolves.toEqual(user);
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          totpSecretEncrypted: null,
          totpEnabledAt: null,
          totpLastUsedStep: null,
          totpFailedAttempts: 0,
          totpLockedUntil: null,
        },
      });
    });

    it('returns null when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection refused'));

      await expect(repository.disableTotp('user-1')).resolves.toBeNull();
    });

    it('does not bump the session-cache generation — disabling MFA ends no other session', async () => {
      const user = { id: 'user-1', totpEnabledAt: null };
      prisma.$transaction.mockImplementation(
        async (operations: unknown[]) => await Promise.all(operations),
      );
      prisma.mfaRecoveryCode.deleteMany.mockResolvedValue({ count: 3 });
      prisma.user.update.mockResolvedValue(user);

      await repository.disableTotp('user-1');

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('recordTotpFailure', () => {
    it('writes the failed-attempt count, the lockout deadline and when the run began', async () => {
      const lockedUntil = new Date('2026-01-01T00:15:00.000Z');
      const firstFailedAt = new Date('2026-01-01T00:00:00.000Z');
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await repository.recordTotpFailure('user-1', 5, lockedUntil, firstFailedAt);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          totpFailedAttempts: 5,
          totpLockedUntil: lockedUntil,
          totpFirstFailedAt: firstFailedAt,
        },
      });
    });

    it('returns null when the write fails', async () => {
      prisma.user.update.mockRejectedValue(new Error('connection refused'));

      await expect(repository.recordTotpFailure('user-1', 1, null, new Date())).resolves.toBeNull();
    });

    it('does not bump the session-cache generation — a lockout counter gates login, not a live session', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await repository.recordTotpFailure('user-1', 5, null, new Date());

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('resetTotpState', () => {
    it('clears the lockout and records the spent step', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await repository.resetTotpState('user-1', 42);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          totpFailedAttempts: 0,
          totpLockedUntil: null,
          totpFirstFailedAt: null,
          totpLastUsedStep: 42,
        },
      });
    });

    it('returns null when the write fails', async () => {
      prisma.user.update.mockRejectedValue(new Error('connection refused'));

      await expect(repository.resetTotpState('user-1', 42)).resolves.toBeNull();
    });

    it('does not bump the session-cache generation — clearing a lockout ends no session', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await repository.resetTotpState('user-1', 42);

      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  describe('findUnusedRecoveryCode', () => {
    it('returns the matching unused code', async () => {
      prisma.mfaRecoveryCode.findFirst.mockResolvedValue({ id: 'code-1' });

      await expect(repository.findUnusedRecoveryCode('user-1', 'hash')).resolves.toEqual({
        id: 'code-1',
      });
      expect(prisma.mfaRecoveryCode.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', codeHash: 'hash', usedAt: null },
      });
    });

    it('returns undefined when no unused code matches', async () => {
      prisma.mfaRecoveryCode.findFirst.mockResolvedValue(null);

      await expect(repository.findUnusedRecoveryCode('user-1', 'hash')).resolves.toBeUndefined();
    });

    it('returns null — distinct from undefined — when the database fails', async () => {
      prisma.mfaRecoveryCode.findFirst.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findUnusedRecoveryCode('user-1', 'hash')).resolves.toBeNull();
    });
  });

  describe('burnRecoveryCode', () => {
    it('marks the code used and returns true', async () => {
      prisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 1 });

      await expect(repository.burnRecoveryCode('code-1')).resolves.toBe(true);
      expect(prisma.mfaRecoveryCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'code-1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('returns false when the write fails', async () => {
      prisma.mfaRecoveryCode.updateMany.mockRejectedValue(new Error('connection refused'));

      await expect(repository.burnRecoveryCode('code-1')).resolves.toBe(false);
    });
  });
});

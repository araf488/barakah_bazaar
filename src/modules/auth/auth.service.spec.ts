import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Language, User, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

const authenticated: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'customer@example.com',
  role: UserRole.CUSTOMER,
};

const persistedUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'customer@example.com',
  phone: '+8801711111111',
  fullName: 'Test Customer',
  passwordHash: null,
  emailVerifiedAt: null,
  phoneVerifiedAt: null,
  passwordChangedAt: null,
  totpSecretEncrypted: null,
  totpEnabledAt: null,
  totpLastUsedStep: null,
  totpFailedAttempts: 0,
  totpFirstFailedAt: null,
  totpLockedUntil: null,
  role: UserRole.CUSTOMER,
  preferredLanguage: Language.BN,
  isActive: true,
  lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2025-12-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('AuthService', () => {
  let repository: { findById: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AuthService;

  beforeEach(() => {
    repository = { findById: jest.fn() };
    logger = createMockLogger();
    service = new AuthService(repository as unknown as AuthRepository, logger);
  });

  describe('resolveProfile', () => {
    it('returns the profile of the caller the guard already authenticated', async () => {
      repository.findById.mockResolvedValue(persistedUser());

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: true,
        data: {
          id: 'user-1',
          email: 'customer@example.com',
          phone: '+8801711111111',
          fullName: 'Test Customer',
          role: UserRole.CUSTOMER,
          createdAt: new Date('2025-12-01T00:00:00.000Z'),
        },
      });
    });

    it('reads by the local user id, not by looking anything up from a claim', async () => {
      repository.findById.mockResolvedValue(persistedUser());

      await service.resolveProfile(authenticated);

      expect(repository.findById).toHaveBeenCalledWith('user-1');
    });

    it('answers 503 when the repository could not reach the database', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 404 if the row is gone by the time this runs', async () => {
      repository.findById.mockResolvedValue(undefined);

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Your session is invalid or has expired. Please sign in again.',
      });
    });

    it('answers 500 and logs when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.findById.mockRejectedValue(failure);

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure, userId: 'user-1' }),
        'Exception occurred in AuthService.resolveProfile',
      );
    });
  });

  describe('resolveActiveUserId', () => {
    it('returns the local user id already on the authenticated caller', async () => {
      const result = await service.resolveActiveUserId(authenticated);

      expect(result).toEqual({ ok: true, data: 'user-1' });
    });

    it('makes no repository call — the guard already resolved and validated the row', async () => {
      await service.resolveActiveUserId(authenticated);

      expect(repository.findById).not.toHaveBeenCalled();
    });
  });
});

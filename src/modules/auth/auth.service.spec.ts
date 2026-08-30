import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Language, User, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

const authenticated: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'customer@example.com',
  role: UserRole.CUSTOMER,
};

const persistedUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  supabaseUserId: authenticated.supabaseUserId,
  email: 'customer@example.com',
  phone: '+8801711111111',
  fullName: 'Test Customer',
  role: UserRole.CUSTOMER,
  preferredLanguage: Language.BN,
  isActive: true,
  lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2025-12-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('AuthService', () => {
  let repository: { upsertFromToken: jest.Mock; findBySupabaseId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AuthService;

  beforeEach(() => {
    repository = { upsertFromToken: jest.fn(), findBySupabaseId: jest.fn() };
    logger = createMockLogger();
    service = new AuthService(repository as unknown as AuthRepository, logger);
  });

  describe('resolveProfile', () => {
    it('returns the profile of an active user', async () => {
      repository.upsertFromToken.mockResolvedValue(persistedUser());

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: true,
        data: {
          id: 'user-1',
          supabaseUserId: '11111111-1111-1111-1111-111111111111',
          email: 'customer@example.com',
          phone: '+8801711111111',
          fullName: 'Test Customer',
          role: UserRole.CUSTOMER,
          createdAt: new Date('2025-12-01T00:00:00.000Z'),
        },
      });
    });

    it('provisions the local row from the token', async () => {
      repository.upsertFromToken.mockResolvedValue(persistedUser());

      await service.resolveProfile(authenticated);

      expect(repository.upsertFromToken).toHaveBeenCalledWith(authenticated);
    });

    it('rejects a disabled account with 403', async () => {
      repository.upsertFromToken.mockResolvedValue(persistedUser({ isActive: false }));

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });
    });

    it('logs a disabled-account attempt', async () => {
      repository.upsertFromToken.mockResolvedValue(persistedUser({ isActive: false }));

      await service.resolveProfile(authenticated);

      expect(logger.warn).toHaveBeenCalledWith(
        { supabaseUserId: authenticated.supabaseUserId },
        'Disabled account attempted to authenticate',
      );
    });

    it('answers 503 when the repository could not reach the database', async () => {
      repository.upsertFromToken.mockResolvedValue(null);

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 500 and logs when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.upsertFromToken.mockRejectedValue(failure);

      const result = await service.resolveProfile(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in AuthService.resolveProfile',
      );
    });
  });

  describe('resolveActiveUserId', () => {
    it('returns the local user id without writing anything', async () => {
      repository.findBySupabaseId.mockResolvedValue(persistedUser());

      const result = await service.resolveActiveUserId(authenticated);

      expect(result).toEqual({ ok: true, data: 'user-1' });
      expect(repository.upsertFromToken).not.toHaveBeenCalled();
    });

    it('looks the user up by the token subject', async () => {
      repository.findBySupabaseId.mockResolvedValue(persistedUser());

      await service.resolveActiveUserId(authenticated);

      expect(repository.findBySupabaseId).toHaveBeenCalledWith(authenticated.supabaseUserId);
    });

    it('answers 404 when the client never exchanged its token at /auth/me', async () => {
      repository.findBySupabaseId.mockResolvedValue(undefined);

      const result = await service.resolveActiveUserId(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'User was not found.',
      });
    });

    it('answers 503 rather than 404 when the read itself failed', async () => {
      repository.findBySupabaseId.mockResolvedValue(null);

      const result = await service.resolveActiveUserId(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 403 for a disabled account holding a valid token', async () => {
      repository.findBySupabaseId.mockResolvedValue(persistedUser({ isActive: false }));

      const result = await service.resolveActiveUserId(authenticated);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });
    });

    it('answers 500 and logs when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.findBySupabaseId.mockRejectedValue(failure);

      const result = await service.resolveActiveUserId(authenticated);

      expect(!result.ok && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in AuthService.resolveActiveUserId',
      );
    });
  });
});

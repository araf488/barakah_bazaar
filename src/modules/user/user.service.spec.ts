import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { AuthService } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

const authenticated: AuthenticatedUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.CUSTOMER,
};

const dto = (fullName = 'Karim Mia'): UpdateProfileDto =>
  Object.assign(new UpdateProfileDto(), { fullName });

describe('UserService', () => {
  let repository: { updateFullName: jest.Mock };
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: UserService;

  beforeEach(() => {
    repository = { updateFullName: jest.fn() };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new UserService(
      repository as unknown as UserRepository,
      authService as unknown as AuthService,
      logger,
    );
  });

  describe('updateProfile', () => {
    it('returns the updated profile', async () => {
      repository.updateFullName.mockResolvedValue(userFixture({ fullName: 'Karim Mia' }));

      const result = await service.updateProfile(authenticated, dto());

      expect(result.ok && result.data.fullName).toBe('Karim Mia');
    });

    it('writes against the resolved local id, not anything from the request', async () => {
      repository.updateFullName.mockResolvedValue(userFixture());

      await service.updateProfile(authenticated, dto());

      expect(repository.updateFullName).toHaveBeenCalledWith('user-1', 'Karim Mia');
    });

    it('returns the same profile shape /auth/me returns', async () => {
      repository.updateFullName.mockResolvedValue(userFixture());

      const result = await service.updateProfile(authenticated, dto());

      expect(result.ok && Object.keys(result.data).sort((a, b) => a.localeCompare(b))).toEqual([
        'createdAt',
        'email',
        'fullName',
        'id',
        'phone',
        'role',
        'supabaseUserId',
      ]);
    });

    it('passes a disabled-account 403 straight through without writing', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      const result = await service.updateProfile(authenticated, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });
      expect(repository.updateFullName).not.toHaveBeenCalled();
    });

    it('passes a 404 for a client that never called /auth/me straight through', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'User was not found.',
      });

      const result = await service.updateProfile(authenticated, dto());

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('answers 503 when the write failed', async () => {
      repository.updateFullName.mockResolvedValue(null);

      const result = await service.updateProfile(authenticated, dto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 500 and logs when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.updateFullName.mockRejectedValue(failure);

      const result = await service.updateProfile(authenticated, dto());

      expect(!result.ok && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in UserService.updateProfile',
      );
    });
  });
});

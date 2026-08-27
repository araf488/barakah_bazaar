import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserProfileDto } from './dto/user-profile.dto';

const authenticated: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'customer@example.com',
  role: UserRole.CUSTOMER,
};

const profile: UserProfileDto = {
  id: 'user-1',
  supabaseUserId: authenticated.supabaseUserId,
  email: 'customer@example.com',
  phone: null,
  fullName: null,
  role: UserRole.CUSTOMER,
  createdAt: new Date('2025-12-01T00:00:00.000Z'),
};

describe('AuthController', () => {
  let authService: { resolveProfile: jest.Mock };
  let controller: AuthController;

  beforeEach(() => {
    authService = { resolveProfile: jest.fn() };
    controller = new AuthController(authService as unknown as AuthService, createMockLogger());
  });

  describe('me', () => {
    it('returns the profile for a verified caller', async () => {
      authService.resolveProfile.mockResolvedValue({ ok: true, data: profile });

      await expect(controller.me(authenticated)).resolves.toEqual(profile);
    });

    it('passes the verified caller through to the service', async () => {
      authService.resolveProfile.mockResolvedValue({ ok: true, data: profile });

      await controller.me(authenticated);

      expect(authService.resolveProfile).toHaveBeenCalledWith(authenticated);
    });

    it('rejects a request with no verified caller', async () => {
      await expect(controller.me(undefined)).rejects.toThrow(UnauthorizedException);
    });

    it('never calls the service without a verified caller', async () => {
      await expect(controller.me(undefined)).rejects.toThrow(UnauthorizedException);

      expect(authService.resolveProfile).not.toHaveBeenCalled();
    });

    it('propagates a disabled account as 403', async () => {
      authService.resolveProfile.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      await expect(controller.me(authenticated)).rejects.toMatchObject({ status: 403 });
    });

    it('propagates a service outage as 503', async () => {
      authService.resolveProfile.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.me(authenticated)).rejects.toThrow(HttpException);
    });
  });
});

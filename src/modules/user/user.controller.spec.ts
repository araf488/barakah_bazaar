import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserController } from './user.controller';
import { UserService } from './user.service';

const authenticated: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.CUSTOMER,
};

const body = (fullName = 'Karim Mia'): UpdateProfileDto =>
  Object.assign(new UpdateProfileDto(), { fullName });

describe('UserController', () => {
  let userService: { updateProfile: jest.Mock };
  let controller: UserController;

  beforeEach(() => {
    userService = { updateProfile: jest.fn() };
    controller = new UserController(userService as unknown as UserService, createMockLogger());
  });

  describe('updateProfile', () => {
    it('returns the profile on success', async () => {
      const profile = { id: 'user-1', fullName: 'Karim Mia' };
      userService.updateProfile.mockResolvedValue({ ok: true, data: profile });

      await expect(controller.updateProfile(authenticated, body())).resolves.toEqual(profile);
    });

    it('passes the verified caller and the validated body to the service', async () => {
      userService.updateProfile.mockResolvedValue({ ok: true, data: {} });
      const dto = body('Rahim Uddin');

      await controller.updateProfile(authenticated, dto);

      expect(userService.updateProfile).toHaveBeenCalledWith(authenticated, dto);
    });

    it('refuses a request with no verified caller', async () => {
      await expect(controller.updateProfile(undefined, body())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(userService.updateProfile).not.toHaveBeenCalled();
    });

    it('passes a service failure through as an HTTP error', async () => {
      userService.updateProfile.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      await expect(controller.updateProfile(authenticated, body())).rejects.toThrow(HttpException);
    });

    it('surfaces the disabled-account message the contract specifies', async () => {
      userService.updateProfile.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      await expect(controller.updateProfile(authenticated, body())).rejects.toThrow(
        'This account has been disabled. Please contact support.',
      );
    });
  });

  describe('UpdateProfileDto validation', () => {
    it('accepts a name', async () => {
      await expect(
        validate(plainToInstance(UpdateProfileDto, { fullName: 'Rahim Uddin' })),
      ).resolves.toEqual([]);
    });

    it('trims before validating', () => {
      const dto = plainToInstance(UpdateProfileDto, { fullName: '  Rahim Uddin  ' });

      expect(dto.fullName).toBe('Rahim Uddin');
    });

    it('accepts a Bangla name', async () => {
      await expect(
        validate(plainToInstance(UpdateProfileDto, { fullName: 'রহিম উদ্দিন' })),
      ).resolves.toEqual([]);
    });

    it.each([
      ['empty', ''],
      ['whitespace only', '    '],
      ['null', null],
      ['absent', undefined],
    ])('rejects a %s name', async (_label, fullName) => {
      const errors = await validate(plainToInstance(UpdateProfileDto, { fullName }));

      expect(errors).not.toEqual([]);
    });

    it('rejects a name longer than the limit', async () => {
      const errors = await validate(
        plainToInstance(UpdateProfileDto, { fullName: 'a'.repeat(121) }),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });
  });
});

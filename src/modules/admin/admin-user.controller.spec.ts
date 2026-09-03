import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminUserController } from './admin-user.controller';
import { AdminUserService } from './admin-user.service';
import { AdminUserQueryDto, ChangeRoleDto } from './dto/admin-user.dto';

const staff: AuthenticatedUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.SUPER_ADMIN,
};

const emptyPage = {
  items: [],
  meta: { page: 1, limit: 20, totalItems: 0, totalPages: 0, hasNextPage: false },
};

describe('AdminUserController', () => {
  let userService: { listUsers: jest.Mock; setAccountEnabled: jest.Mock; changeRole: jest.Mock };
  let controller: AdminUserController;

  beforeEach(() => {
    userService = {
      listUsers: jest.fn().mockResolvedValue({ ok: true, data: emptyPage }),
      setAccountEnabled: jest.fn().mockResolvedValue({ ok: true, data: { id: 'user-2' } }),
      changeRole: jest.fn().mockResolvedValue({ ok: true, data: { id: 'user-2' } }),
    };
    controller = new AdminUserController(
      userService as unknown as AdminUserService,
      createMockLogger(),
    );
  });

  describe('list', () => {
    it('returns the page and passes the validated query through', async () => {
      const query = Object.assign(new AdminUserQueryDto(), { search: 'rahim' });

      await expect(controller.list(query)).resolves.toEqual(emptyPage);
      expect(userService.listUsers).toHaveBeenCalledWith(query);
    });

    it('translates a service failure into an HTTP error', async () => {
      userService.listUsers.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.list(new AdminUserQueryDto())).rejects.toThrow(HttpException);
    });
  });

  describe('disable and enable', () => {
    it('disables by asking for enabled=false', async () => {
      await controller.disable(staff, 'user-2');

      expect(userService.setAccountEnabled).toHaveBeenCalledWith(staff, 'user-2', false);
    });

    it('enables by asking for enabled=true', async () => {
      await controller.enable(staff, 'user-2');

      expect(userService.setAccountEnabled).toHaveBeenCalledWith(staff, 'user-2', true);
    });

    it('surfaces the self-action refusal', async () => {
      userService.setAccountEnabled.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message:
          'You cannot change your own account here. Ask another super admin to make this change.',
      });

      await expect(controller.disable(staff, 'user-1')).rejects.toThrow(
        'You cannot change your own account here. Ask another super admin to make this change.',
      );
    });

    it('surfaces the last-super-admin conflict', async () => {
      userService.setAccountEnabled.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This is the only super admin. Promote someone else before changing this account.',
      });

      await expect(controller.disable(staff, 'user-2')).rejects.toMatchObject({ status: 409 });
    });

    it('refuses with no verified caller', async () => {
      await expect(controller.disable(undefined, 'user-2')).rejects.toThrow(UnauthorizedException);
      expect(userService.setAccountEnabled).not.toHaveBeenCalled();
    });
  });

  describe('changeRole', () => {
    it('passes the target and the requested role through', async () => {
      const dto = Object.assign(new ChangeRoleDto(), { role: UserRole.OPS });

      await controller.changeRole(staff, 'user-2', dto);

      expect(userService.changeRole).toHaveBeenCalledWith(staff, 'user-2', dto);
    });

    it('surfaces a partial change distinctly from a clean failure', async () => {
      // Supabase already accepted the role; the operator must know the systems disagree.
      userService.changeRole.mockResolvedValue({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          'The role was changed in the identity provider but could not be recorded locally. Contact an administrator before making further changes.',
      });

      await expect(controller.changeRole(staff, 'user-2', new ChangeRoleDto())).rejects.toThrow(
        'The role was changed in the identity provider but could not be recorded locally. Contact an administrator before making further changes.',
      );
    });

    it('refuses with no verified caller', async () => {
      await expect(controller.changeRole(undefined, 'user-2', new ChangeRoleDto())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('DTO validation', () => {
    it('accepts an empty user query', async () => {
      await expect(validate(plainToInstance(AdminUserQueryDto, {}))).resolves.toEqual([]);
    });

    it('rejects a role outside the enum', async () => {
      const errors = await validate(plainToInstance(AdminUserQueryDto, { role: 'OWNER' }));

      expect(errors).not.toEqual([]);
    });

    it('coerces the isActive flag from a query string', () => {
      const dto = plainToInstance(AdminUserQueryDto, { isActive: 'false' });

      expect(dto.isActive).toBe(false);
    });

    it('requires a role on a change request', async () => {
      const errors = await validate(plainToInstance(ChangeRoleDto, {}));

      expect(errors.map((error) => error.property)).toContain('role');
    });

    it.each(Object.values(UserRole))('accepts %s as a target role', async (role) => {
      await expect(validate(plainToInstance(ChangeRoleDto, { role }))).resolves.toEqual([]);
    });
  });
});

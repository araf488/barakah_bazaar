import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminUserController } from './admin-user.controller';
import { AdminUserService } from './admin-user.service';
import { AdminUserQueryDto, ChangeRoleDto, CreateCustomerDto } from './dto/admin-user.dto';

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
  let userService: {
    listUsers: jest.Mock;
    setAccountEnabled: jest.Mock;
    changeRole: jest.Mock;
    createCustomer: jest.Mock;
  };
  let controller: AdminUserController;

  beforeEach(() => {
    userService = {
      listUsers: jest.fn().mockResolvedValue({ ok: true, data: emptyPage }),
      setAccountEnabled: jest.fn().mockResolvedValue({ ok: true, data: { id: 'user-2' } }),
      changeRole: jest.fn().mockResolvedValue({ ok: true, data: { id: 'user-2' } }),
      createCustomer: jest.fn().mockResolvedValue({
        ok: true,
        data: { user: { id: 'user-9' }, passwordSetupEmailQueued: true },
      }),
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

  describe('create', () => {
    const body = Object.assign(new CreateCustomerDto(), {
      email: 'aisha@example.com',
      fullName: 'Aisha Rahman',
    });

    it('is open to SUPER_ADMIN and SUPPORT only, and answers 201', () => {
      const handler = AdminUserController.prototype.create;

      expect(Reflect.getMetadata('barakah:roles', handler)).toEqual(['SUPER_ADMIN', 'SUPPORT']);
      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(201);
    });

    it('returns the created customer and passes the caller and body through', async () => {
      await expect(controller.create(staff, body)).resolves.toEqual({
        user: { id: 'user-9' },
        passwordSetupEmailQueued: true,
      });
      expect(userService.createCustomer).toHaveBeenCalledWith(staff, body);
    });

    it('surfaces the 409 for an existing account', async () => {
      userService.createCustomer.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'An account already exists for that email address.',
      });

      await expect(controller.create(staff, body)).rejects.toMatchObject({ status: 409 });
    });

    it('refuses with no verified caller', async () => {
      await expect(controller.create(undefined, body)).rejects.toThrow(UnauthorizedException);
      expect(userService.createCustomer).not.toHaveBeenCalled();
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

  describe('CreateCustomerDto validation', () => {
    const valid = { email: 'aisha@example.com', fullName: 'Aisha Rahman' };
    const check = (payload: object) =>
      validate(plainToInstance(CreateCustomerDto, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('accepts a valid payload, with and without a language', async () => {
      await expect(check(valid)).resolves.toEqual([]);
      await expect(check({ ...valid, preferredLanguage: 'EN' })).resolves.toEqual([]);
    });

    it('rejects a role field', async () => {
      const errors = await check({ ...valid, role: 'SUPER_ADMIN' });

      expect(errors.map((error) => error.property)).toContain('role');
    });

    it('rejects a whitespace-only fullName', async () => {
      const errors = await check({ ...valid, fullName: '   ' });

      expect(errors.map((error) => error.property)).toContain('fullName');
    });

    it('rejects a fullName over 120 characters and accepts exactly 120', async () => {
      const tooLong = await check({ ...valid, fullName: 'a'.repeat(121) });
      const atLimit = await check({ ...valid, fullName: 'a'.repeat(120) });

      expect(tooLong.map((error) => error.property)).toContain('fullName');
      expect(atLimit).toEqual([]);
    });

    it('rejects a bad email', async () => {
      const errors = await check({ ...valid, email: 'not-an-email' });

      expect(errors.map((error) => error.property)).toContain('email');
    });

    it('rejects a language outside the enum', async () => {
      const errors = await check({ ...valid, preferredLanguage: 'FR' });

      expect(errors.map((error) => error.property)).toContain('preferredLanguage');
    });
  });
});

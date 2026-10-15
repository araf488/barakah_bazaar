import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthSettingsAdminController } from './auth-settings-admin.controller';
import { AuthSettingsAdminService } from './auth-settings-admin.service';
import { UpdateAuthSettingsDto } from './dto/auth-settings.dto';

const superAdmin: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'boss@barakahbazaar.com.bd',
  role: UserRole.SUPER_ADMIN,
};

const settings = {
  accessTokenMinutes: 30,
  customerRefreshIdleMinutes: 43200,
  customerRefreshAbsoluteMinutes: 129600,
  staffRefreshIdleMinutes: 720,
  staffRefreshAbsoluteMinutes: 10080,
  staffMfaRequired: true,
  emailVerificationGraceHours: 168,
  refreshReuseGraceSeconds: 30,
};

describe('AuthSettingsAdminController', () => {
  let service: { view: jest.Mock; update: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let controller: AuthSettingsAdminController;

  beforeEach(() => {
    service = { view: jest.fn(), update: jest.fn() };
    logger = createMockLogger();
    controller = new AuthSettingsAdminController(
      service as unknown as AuthSettingsAdminService,
      logger,
    );
  });

  it('restricts both routes to super admins', () => {
    expect(new Reflector().get(MetadataKeys.Roles, AuthSettingsAdminController)).toEqual([
      'SUPER_ADMIN',
    ]);
  });

  it('returns what the service read', async () => {
    const view = { settings, fallbacks: [], updatedAt: null };
    service.view.mockResolvedValue({ ok: true, data: view });

    await expect(controller.view()).resolves.toEqual(view);
  });

  it('passes the caller and the body through on update', async () => {
    const answer = { settings, propagatesWithinSeconds: 60, staffSessionsRevoked: 0 };
    service.update.mockResolvedValue({ ok: true, data: answer });

    await expect(controller.update(superAdmin, { accessTokenMinutes: 30 })).resolves.toEqual(
      answer,
    );
    expect(service.update).toHaveBeenCalledWith(superAdmin, { accessTokenMinutes: 30 });
  });

  it('passes the revoked staff session count through unchanged', async () => {
    const answer = { settings, propagatesWithinSeconds: 60, staffSessionsRevoked: 7 };
    service.update.mockResolvedValue({ ok: true, data: answer });

    const response = await controller.update(superAdmin, { staffMfaRequired: true });

    expect(response.staffSessionsRevoked).toBe(7);
    expect(service.update).toHaveBeenCalledWith(superAdmin, { staffMfaRequired: true });
  });

  it('turns a conflict into a 409 with the reload message', async () => {
    service.update.mockResolvedValue({
      ok: false,
      status: HttpStatus.CONFLICT,
      message: 'The auth settings changed while you were editing. Reload them and try again.',
    });

    await expect(controller.update(superAdmin, { staffMfaRequired: true })).rejects.toMatchObject({
      status: 409,
      message: 'The auth settings changed while you were editing. Reload them and try again.',
    });
  });

  it('turns a refused update into the HTTP error it describes, and logs it', async () => {
    service.update.mockResolvedValue({
      ok: false,
      status: HttpStatus.BAD_REQUEST,
      message: 'Nothing to change.',
    });

    const error = (await controller.update(superAdmin, {}).catch((e: unknown) => e)) as
      HttpException | undefined;

    expect(error).toBeInstanceOf(HttpException);
    expect(error?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error?.message).toBe('Nothing to change.');
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(HttpException) },
      'Exception occurred in AuthSettingsAdminController.update',
    );
  });

  it('turns a failed read into a 503', async () => {
    service.view.mockResolvedValue({
      ok: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'down',
    });

    await expect(controller.view()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(HttpException) },
      'Exception occurred in AuthSettingsAdminController.view',
    );
  });
});

describe('UpdateAuthSettingsDto validation', () => {
  const failedFields = async (payload: object): Promise<string[]> =>
    (
      await validate(plainToInstance(UpdateAuthSettingsDto, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('accepts a full, valid payload', async () => {
    await expect(failedFields({ ...settings, confirmDisableStaffMfa: true })).resolves.toEqual([]);
  });

  it('accepts an empty payload — "nothing to change" is the service\'s answer', async () => {
    await expect(failedFields({})).resolves.toEqual([]);
  });

  it('rejects a string for accessTokenMinutes', async () => {
    await expect(failedFields({ accessTokenMinutes: '30' })).resolves.toEqual([
      'accessTokenMinutes',
    ]);
  });

  it('rejects an unknown field', async () => {
    await expect(failedFields({ sessionMinutes: 30 })).resolves.toEqual(['sessionMinutes']);
  });

  it.each(Object.keys(settings))(
    'rejects an explicit null %s at the DTO, with no NaN in any message',
    async (field) => {
      const errors = await validate(plainToInstance(UpdateAuthSettingsDto, { [field]: null }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errors.map((e) => e.property)).toEqual([field]);
      const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.filter((message) => message.includes('NaN'))).toEqual([]);
    },
  );

  it('still lets confirmDisableStaffMfa be null, since it is not a setting', async () => {
    await expect(failedFields({ confirmDisableStaffMfa: null })).resolves.toEqual([]);
  });

  it('rejects a non-integer before the rules see it', async () => {
    await expect(failedFields({ staffRefreshIdleMinutes: 720.5 })).resolves.toEqual([
      'staffRefreshIdleMinutes',
    ]);
  });

  it.each([
    ['customerRefreshIdleMinutes', 5_256_001],
    ['customerRefreshAbsoluteMinutes', 5_256_001],
    ['staffRefreshIdleMinutes', 5_256_001],
    ['staffRefreshAbsoluteMinutes', 5_256_001],
    ['accessTokenMinutes', 121],
    ['accessTokenMinutes', 4],
    ['refreshReuseGraceSeconds', 121],
    ['refreshReuseGraceSeconds', -1],
    ['emailVerificationGraceHours', 721],
    ['emailVerificationGraceHours', -1],
    ['staffRefreshIdleMinutes', -1],
    ['customerRefreshAbsoluteMinutes', 2_147_483_648],
  ])('rejects %s = %d as out of bounds', async (field, value) => {
    await expect(failedFields({ [field]: value })).resolves.toEqual([field]);
  });

  it.each([
    ['customerRefreshAbsoluteMinutes', 5_256_000],
    ['accessTokenMinutes', 120],
    ['accessTokenMinutes', 5],
    ['refreshReuseGraceSeconds', 0],
    ['emailVerificationGraceHours', 720],
  ])('accepts %s = %d at its bound', async (field, value) => {
    await expect(failedFields({ [field]: value })).resolves.toEqual([]);
  });

  it('rejects a non-boolean staffMfaRequired and confirmDisableStaffMfa', async () => {
    await expect(
      failedFields({ staffMfaRequired: 'false', confirmDisableStaffMfa: 'yes' }),
    ).resolves.toEqual(['staffMfaRequired', 'confirmDisableStaffMfa']);
  });
});

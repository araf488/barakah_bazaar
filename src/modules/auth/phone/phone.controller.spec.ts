import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createMockLogger } from '../../../../test/support/mocks';
import { MetadataKeys } from '../../../common/constants/app.constants';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { UserRole } from '../../../infra/prisma/prisma-client';
import { PhoneConfirmDto, PhoneRequestDto } from './dto/phone.dto';
import { PhoneController } from './phone.controller';

/** The global pipe exactly as `main.ts` installs it, ahead of every handler. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const user: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'aisha@example.com',
  role: UserRole.CUSTOMER,
};

/** The statuses Swagger documents for a handler, ascending. */
const documentedStatuses = (handler: object): number[] =>
  Object.keys(
    (Reflect.getMetadata('swagger/apiResponse', handler) ?? {}) as Record<string, unknown>,
  )
    .map(Number)
    .sort((a, b) => a - b);

describe('PhoneController', () => {
  let verification: { request: jest.Mock; confirm: jest.Mock };
  let phoneLogin: { request: jest.Mock; verify: jest.Mock };
  let controller: PhoneController;

  beforeEach(() => {
    verification = { request: jest.fn(), confirm: jest.fn() };
    phoneLogin = { request: jest.fn(), verify: jest.fn() };
    controller = new PhoneController(
      verification as never,
      phoneLogin as never,
      createMockLogger(),
    );
  });

  describe('request', () => {
    const dto: PhoneRequestDto = { phone: '01712345678' };

    it('passes the signed-in caller and body to the service and returns its data', async () => {
      const data = { expiresInSeconds: 300, resendAfterSeconds: 60 };
      verification.request.mockResolvedValue({ ok: true, data });

      await expect(controller.request(dto, user)).resolves.toEqual(data);
      expect(verification.request).toHaveBeenCalledWith(user, dto);
    });

    it('turns a service failure into its HTTP status', async () => {
      verification.request.mockResolvedValue({ ok: false, status: 429, message: 'Wait.' });

      const error = await controller.request(dto, user).catch((caught: HttpException) => caught);

      expect((error as HttpException).getStatus()).toBe(429);
    });

    it('rejects a request with no verified caller, never calling the service', async () => {
      await expect(controller.request(dto, undefined)).rejects.toThrow(UnauthorizedException);
      expect(verification.request).not.toHaveBeenCalled();
    });

    it('answers 202, is not public, and uses the ip and phone buckets', () => {
      const handler = PhoneController.prototype.request;
      const reflector = new Reflector();

      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(202);
      expect(reflector.get<boolean>(MetadataKeys.IsPublic, handler)).toBeUndefined();
      expect(reflector.get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual([
        'auth-ip',
        'auth-phone',
      ]);
    });

    /** Runs the body through the global pipe, then the handler: the real request order. */
    const handle = async (body: unknown) =>
      controller.request(
        (await pipe.transform(body, {
          type: 'body',
          metatype: PhoneRequestDto,
        })) as PhoneRequestDto,
        user,
      );

    it('rejects an invalid payload in the pipe, so the service is never called', async () => {
      await expect(handle({ phone: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
      expect(verification.request).not.toHaveBeenCalled();
    });

    it('lets a valid payload through the same pipe to the service', async () => {
      verification.request.mockResolvedValue({
        ok: true,
        data: { expiresInSeconds: 300, resendAfterSeconds: 60 },
      });

      await handle({ phone: ' 01712345678 ' });

      expect(verification.request).toHaveBeenCalledWith(user, { phone: '01712345678' });
    });
  });

  describe('confirm', () => {
    const dto: PhoneConfirmDto = { phone: '01712345678', code: '012345' };

    it('passes the signed-in caller and body to the service and returns its data', async () => {
      const data = { phone: '+8801712345678', phoneVerified: true };
      verification.confirm.mockResolvedValue({ ok: true, data });

      await expect(controller.confirm(dto, user)).resolves.toEqual(data);
      expect(verification.confirm).toHaveBeenCalledWith(user, dto);
    });

    it('turns a service failure into its HTTP status', async () => {
      verification.confirm.mockResolvedValue({ ok: false, status: 410, message: 'Expired.' });

      const error = await controller.confirm(dto, user).catch((caught: HttpException) => caught);

      expect((error as HttpException).getStatus()).toBe(410);
    });

    it('rejects a request with no verified caller, never calling the service', async () => {
      await expect(controller.confirm(dto, undefined)).rejects.toThrow(UnauthorizedException);
      expect(verification.confirm).not.toHaveBeenCalled();
    });

    it('answers 200, is not public, and uses the ip and phone buckets', () => {
      const handler = PhoneController.prototype.confirm;
      const reflector = new Reflector();

      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
      expect(reflector.get<boolean>(MetadataKeys.IsPublic, handler)).toBeUndefined();
      expect(reflector.get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual([
        'auth-ip',
        'auth-phone',
      ]);
    });
  });

  describe('loginRequest', () => {
    const dto: PhoneRequestDto = { phone: '01712345678' };
    const req = { ip: '203.0.113.7', headers: {} } as never;

    it('passes the body and caller ip to the service and returns its data', async () => {
      const data = { expiresInSeconds: 300, resendAfterSeconds: 60 };
      phoneLogin.request.mockResolvedValue({ ok: true, data });

      await expect(controller.loginRequest(dto, req)).resolves.toEqual(data);
      expect(phoneLogin.request).toHaveBeenCalledWith(dto, '203.0.113.7');
    });

    it('turns a service failure into its HTTP status', async () => {
      phoneLogin.request.mockResolvedValue({ ok: false, status: 503, message: 'Down.' });

      const error = await controller.loginRequest(dto, req).catch((c: HttpException) => c);

      expect((error as HttpException).getStatus()).toBe(503);
    });

    it('is public, answers 202 and uses the ip and phone buckets', () => {
      const handler = PhoneController.prototype.loginRequest;
      const reflector = new Reflector();

      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(202);
      expect(reflector.get<boolean>(MetadataKeys.IsPublic, handler)).toBe(true);
      expect(reflector.get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual([
        'auth-ip',
        'auth-phone',
      ]);
    });
  });

  describe('loginVerify', () => {
    const dto: PhoneConfirmDto = { phone: '01712345678', code: '012345' };
    const req = (headers: Record<string, string>) =>
      ({ ip: '203.0.113.7', headers: { 'user-agent': 'ua', ...headers } }) as never;

    it('reads device id and user agent like POST /auth/login and maps the result', async () => {
      phoneLogin.verify.mockResolvedValue({ ok: true, data: { kind: 'mfa', mfaToken: 'tok' } });

      await expect(controller.loginVerify(dto, req({ 'x-device-id': 'dev-1' }))).resolves.toEqual({
        kind: 'mfa',
        mfaToken: 'tok',
      });
      expect(phoneLogin.verify).toHaveBeenCalledWith(dto, 'dev-1', 'ua', '203.0.113.7');
    });

    it('answers 400 for a missing device id, never calling the service', async () => {
      const error = await controller.loginVerify(dto, req({})).catch((c: HttpException) => c);

      expect((error as HttpException).getStatus()).toBe(400);
      expect(phoneLogin.verify).not.toHaveBeenCalled();
    });

    it('turns a service failure into its HTTP status', async () => {
      phoneLogin.verify.mockResolvedValue({ ok: false, status: 401, message: 'No.' });

      const error = await controller
        .loginVerify(dto, req({ 'x-device-id': 'dev-1' }))
        .catch((c: HttpException) => c);

      expect((error as HttpException).getStatus()).toBe(401);
    });

    it('is public, answers 200 and uses the ip and phone buckets', () => {
      const handler = PhoneController.prototype.loginVerify;
      const reflector = new Reflector();

      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
      expect(reflector.get<boolean>(MetadataKeys.IsPublic, handler)).toBe(true);
      expect(reflector.get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual([
        'auth-ip',
        'auth-phone',
      ]);
    });
  });

  describe('Swagger documents every status each route can answer', () => {
    it.each([
      ['request', [202, 400, 401, 409, 429, 503]],
      ['confirm', [200, 400, 401, 409, 410, 503]],
      ['loginRequest', [202, 400, 429, 503]],
      ['loginVerify', [200, 400, 401, 403, 429, 503]],
    ] as const)('%s', (name, statuses) => {
      expect(documentedStatuses(PhoneController.prototype[name])).toEqual(statuses);
    });
  });
});

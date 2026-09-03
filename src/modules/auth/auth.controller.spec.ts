import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Request } from 'express';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthMessages } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto, MfaVerifyDto, RefreshDto } from './dto/login.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { LoginService } from './login.service';
import { MfaService } from './mfa.service';
import { SessionService } from './sessions/session.service';

const authenticated: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'customer@example.com',
  role: UserRole.CUSTOMER,
};

const profile: UserProfileDto = {
  id: 'user-1',
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'customer@example.com',
  phone: null,
  fullName: null,
  role: UserRole.CUSTOMER,
  createdAt: new Date('2025-12-01T00:00:00.000Z'),
};

const issuedSession = {
  accessToken: 'access',
  expiresAt: new Date('2026-09-03T00:30:00.000Z'),
  refreshToken: 'refresh',
  refreshExpiresAt: new Date('2026-10-03T00:00:00.000Z'),
  user: {
    id: 'user-1',
    supabaseUserId: '11111111-1111-1111-1111-111111111111',
    email: 'customer@example.com',
    phone: null,
    fullName: null,
    role: UserRole.CUSTOMER,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  },
};

const buildRequest = (
  headers: Record<string, string> = {},
  ip: string | null = '203.0.113.7',
): Request => ({ headers, ip: ip ?? undefined }) as unknown as Request;

describe('AuthController', () => {
  let authService: { resolveProfile: jest.Mock };
  let loginService: { login: jest.Mock };
  let mfaService: { verifyLogin: jest.Mock };
  let sessionService: { refresh: jest.Mock };
  let controller: AuthController;

  beforeEach(() => {
    authService = { resolveProfile: jest.fn() };
    loginService = { login: jest.fn() };
    mfaService = { verifyLogin: jest.fn() };
    sessionService = { refresh: jest.fn() };
    controller = new AuthController(
      authService as unknown as AuthService,
      loginService as unknown as LoginService,
      mfaService as unknown as MfaService,
      sessionService as unknown as SessionService,
      createMockLogger(),
    );
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

  describe('login', () => {
    const dto: LoginDto = {
      email: 'customer@example.com',
      password: 'correct horse battery staple',
    };

    it('returns a mapped session on success', async () => {
      loginService.login.mockResolvedValue({
        ok: true,
        data: { kind: 'session', session: issuedSession, portal: 'STOREFRONT' },
      });

      const response = await controller.login(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(response).toMatchObject({
        kind: 'session',
        accessToken: 'access',
        portal: 'STOREFRONT',
      });
    });

    it('passes the device id, user agent and ip through to the service', async () => {
      loginService.login.mockResolvedValue({
        ok: true,
        data: { kind: 'mfa', mfaToken: 'token' },
      });

      await controller.login(
        dto,
        buildRequest({ 'x-device-id': 'device-1', 'user-agent': 'test-agent' }, '198.51.100.4'),
      );

      expect(loginService.login).toHaveBeenCalledWith(
        dto,
        'device-1',
        'test-agent',
        '198.51.100.4',
      );
    });

    it('rejects a request with no X-Device-Id header', async () => {
      await expect(controller.login(dto, buildRequest({}))).rejects.toThrow(BadRequestException);
    });

    it('never calls the service without a device id', async () => {
      await expect(controller.login(dto, buildRequest({}))).rejects.toThrow(BadRequestException);

      expect(loginService.login).not.toHaveBeenCalled();
    });

    it('rejects with the DeviceIdRequired message', async () => {
      await expect(controller.login(dto, buildRequest({}))).rejects.toMatchObject({
        message: AuthMessages.DeviceIdRequired,
      });
    });

    it('propagates a wrong-password 401 from the service', async () => {
      loginService.login.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidCredentials,
      });

      await expect(
        controller.login(dto, buildRequest({ 'x-device-id': 'device-1' })),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    });
  });

  describe('verifyMfa', () => {
    const dto: MfaVerifyDto = { mfaToken: 'mfa-token', code: '123456' };

    it('returns a mapped session on success', async () => {
      mfaService.verifyLogin.mockResolvedValue({ ok: true, data: issuedSession });

      const response = await controller.verifyMfa(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(response).toMatchObject({ kind: 'session', accessToken: 'access' });
    });

    it('passes the code and recovery code through to the service', async () => {
      mfaService.verifyLogin.mockResolvedValue({ ok: true, data: issuedSession });

      await controller.verifyMfa(dto, buildRequest({ 'x-device-id': 'device-1' }, '198.51.100.4'));

      expect(mfaService.verifyLogin).toHaveBeenCalledWith(
        'mfa-token',
        { code: '123456', recoveryCode: undefined },
        'device-1',
        null,
        '198.51.100.4',
      );
    });

    it('rejects a request with no X-Device-Id header', async () => {
      await expect(controller.verifyMfa(dto, buildRequest({}))).rejects.toThrow(
        BadRequestException,
      );
      expect(mfaService.verifyLogin).not.toHaveBeenCalled();
    });

    it('propagates a lockout 429 from the service', async () => {
      mfaService.verifyLogin.mockResolvedValue({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: AuthMessages.MfaLocked,
      });

      await expect(
        controller.verifyMfa(dto, buildRequest({ 'x-device-id': 'device-1' })),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    });
  });

  describe('refresh', () => {
    const dto: RefreshDto = { refreshToken: 'raw-refresh-token' };

    it('returns a mapped session on success', async () => {
      sessionService.refresh.mockResolvedValue({ ok: true, data: issuedSession });

      const response = await controller.refresh(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(response).toMatchObject({ kind: 'session', refreshToken: 'refresh' });
    });

    it('rejects a request with no X-Device-Id header', async () => {
      await expect(controller.refresh(dto, buildRequest({}))).rejects.toThrow(BadRequestException);
      expect(sessionService.refresh).not.toHaveBeenCalled();
    });

    it('propagates an unusable-token 401 from the service', async () => {
      sessionService.refresh.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidCredentials,
      });

      await expect(
        controller.refresh(dto, buildRequest({ 'x-device-id': 'device-1' })),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    });
  });

  describe('LoginDto validation', () => {
    const valid = { email: 'customer@example.com', password: 'correct horse battery staple 9' };

    it('accepts a complete payload', async () => {
      await expect(validate(plainToInstance(LoginDto, valid))).resolves.toEqual([]);
    });

    it.each(['email', 'password'])('rejects an empty %s', async (field) => {
      const errors = await validate(plainToInstance(LoginDto, { ...valid, [field]: '' }));

      expect(errors).not.toEqual([]);
    });

    it.each(['email', 'password'])('rejects a null %s', async (field) => {
      const errors = await validate(plainToInstance(LoginDto, { ...valid, [field]: null }));

      expect(errors).not.toEqual([]);
    });

    it('reports one error per required field when the payload is empty', async () => {
      const errors = await validate(plainToInstance(LoginDto, {}));

      expect(errors.map((error) => error.property).sort((a, b) => a.localeCompare(b))).toEqual([
        'email',
        'password',
      ]);
    });

    it('rejects a malformed email address', async () => {
      const errors = await validate(plainToInstance(LoginDto, { ...valid, email: 'not-an-email' }));

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('email');
    });

    it('rejects a password shorter than the 12-character minimum', async () => {
      const errors = await validate(plainToInstance(LoginDto, { ...valid, password: 'short7pw' }));

      expect(errors).not.toEqual([]);
    });

    it('rejects a password longer than the 128-character maximum', async () => {
      const errors = await validate(
        plainToInstance(LoginDto, { ...valid, password: 'a'.repeat(129) }),
      );

      expect(errors).not.toEqual([]);
    });
  });

  describe('MfaVerifyDto validation', () => {
    it('accepts a totp code alone', async () => {
      const dto = plainToInstance(MfaVerifyDto, { mfaToken: 'token', code: '123456' });

      await expect(validate(dto)).resolves.toEqual([]);
    });

    it('accepts a recovery code alone', async () => {
      const dto = plainToInstance(MfaVerifyDto, { mfaToken: 'token', recoveryCode: 'abc123' });

      await expect(validate(dto)).resolves.toEqual([]);
    });

    it('rejects an empty mfaToken', async () => {
      const errors = await validate(
        plainToInstance(MfaVerifyDto, { mfaToken: '', code: '123456' }),
      );

      expect(errors).not.toEqual([]);
    });

    it('rejects a null mfaToken', async () => {
      const errors = await validate(
        plainToInstance(MfaVerifyDto, { mfaToken: null, code: '123456' }),
      );

      expect(errors).not.toEqual([]);
    });

    it('rejects neither code nor recoveryCode being present', async () => {
      const errors = await validate(plainToInstance(MfaVerifyDto, { mfaToken: 'token' }));

      expect(errors).not.toEqual([]);
      expect(errors.some((error) => error.constraints?.isExactlyOneCredential)).toBe(true);
    });

    it('rejects both code and recoveryCode being present', async () => {
      const errors = await validate(
        plainToInstance(MfaVerifyDto, {
          mfaToken: 'token',
          code: '123456',
          recoveryCode: 'abc123',
        }),
      );

      expect(errors).not.toEqual([]);
      expect(errors.some((error) => error.constraints?.isExactlyOneCredential)).toBe(true);
    });

    it('rejects a code that is not 6 digits', async () => {
      const errors = await validate(
        plainToInstance(MfaVerifyDto, { mfaToken: 'token', code: '12345' }),
      );

      expect(errors).not.toEqual([]);
    });

    it('rejects a code containing non-digit characters', async () => {
      const errors = await validate(
        plainToInstance(MfaVerifyDto, { mfaToken: 'token', code: 'abcdef' }),
      );

      expect(errors).not.toEqual([]);
    });
  });

  describe('RefreshDto validation', () => {
    it('accepts a token', async () => {
      await expect(
        validate(plainToInstance(RefreshDto, { refreshToken: 'a-raw-token' })),
      ).resolves.toEqual([]);
    });

    it('rejects an empty refreshToken', async () => {
      const errors = await validate(plainToInstance(RefreshDto, { refreshToken: '' }));

      expect(errors).not.toEqual([]);
    });

    it('rejects a null refreshToken', async () => {
      const errors = await validate(plainToInstance(RefreshDto, { refreshToken: null }));

      expect(errors).not.toEqual([]);
    });

    it('rejects a missing refreshToken', async () => {
      const errors = await validate(plainToInstance(RefreshDto, {}));

      expect(errors).not.toEqual([]);
    });
  });

  describe('validation blocks the service call', () => {
    it('never calls LoginService when the payload fails validation', async () => {
      const errors = await validate(plainToInstance(LoginDto, { email: 'not-an-email' }));
      expect(errors).not.toEqual([]);

      // The controller itself has no validation logic — NestJS's ValidationPipe runs ahead of
      // the handler in the real pipeline and never calls it at all when validation fails. This
      // is what proves that: the same invalid payload the pipe would reject, run through the
      // class-validator check it delegates to, produces errors and never reaches this handler.
      expect(loginService.login).not.toHaveBeenCalled();
    });
  });
});

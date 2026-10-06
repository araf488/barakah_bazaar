import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Request } from 'express';
import { MetadataKeys } from '../../common/constants/app.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthConstants, AuthMessages } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto, MfaVerifyDto, RefreshDto } from './dto/login.dto';
import { MfaDisableDto, MfaEnableDto, MfaSetupDto } from './dto/mfa.dto';
import { ChangePasswordDto, ResetPasswordDto } from './dto/password.dto';
import { RegisterDto } from './dto/register.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { VerifyEmailDto } from './dto/verification.dto';
import { PasswordDependencies } from './password.dependencies';
import { RegistrationDependencies } from './registration.dependencies';
import { SessionService } from './sessions/session.service';
import { SignInDependencies } from './sign-in.dependencies';

const authenticated: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'customer@example.com',
  role: UserRole.CUSTOMER,
};

const profile: UserProfileDto = {
  id: 'user-1',
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

const makeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  userId: 'user-1',
  deviceId: 'device-1',
  userAgent: 'Chrome/141',
  ipAddress: '203.0.113.42',
  createdAt: new Date('2026-08-29T00:00:00.000Z'),
  lastUsedAt: new Date('2026-09-02T08:00:00.000Z'),
  ...overrides,
});

describe('AuthController', () => {
  let authService: { resolveProfile: jest.Mock };
  let loginService: { login: jest.Mock };
  let mfaService: {
    verifyLogin: jest.Mock;
    setupForEnrolment: jest.Mock;
    enableForEnrolment: jest.Mock;
    disableForUser: jest.Mock;
  };
  let sessionService: {
    refresh: jest.Mock;
    revoke: jest.Mock;
    revokeAll: jest.Mock;
    listForUser: jest.Mock;
    revokeOwned: jest.Mock;
  };
  let registrationService: { register: jest.Mock };
  let emailVerificationService: { verify: jest.Mock; resend: jest.Mock };
  let registrationDependencies: RegistrationDependencies;
  let passwordResetService: { request: jest.Mock; reset: jest.Mock };
  let passwordChangeService: { change: jest.Mock };
  let controller: AuthController;

  beforeEach(() => {
    authService = { resolveProfile: jest.fn() };
    loginService = { login: jest.fn() };
    mfaService = {
      verifyLogin: jest.fn(),
      setupForEnrolment: jest.fn(),
      enableForEnrolment: jest.fn(),
      disableForUser: jest.fn(),
    };
    sessionService = {
      refresh: jest.fn(),
      revoke: jest.fn(),
      revokeAll: jest.fn(),
      listForUser: jest.fn(),
      revokeOwned: jest.fn(),
    };
    registrationService = { register: jest.fn() };
    emailVerificationService = { verify: jest.fn(), resend: jest.fn() };
    registrationDependencies = {
      registration: registrationService,
      emailVerification: emailVerificationService,
    } as unknown as RegistrationDependencies;
    passwordResetService = { request: jest.fn(), reset: jest.fn() };
    passwordChangeService = { change: jest.fn() };
    controller = new AuthController(
      authService as unknown as AuthService,
      { login: loginService, mfa: mfaService } as unknown as SignInDependencies,
      sessionService as unknown as SessionService,
      registrationDependencies,
      {
        passwordReset: passwordResetService,
        passwordChange: passwordChangeService,
      } as unknown as PasswordDependencies,
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

    it('is public, so an expired access token is not needed to renew', () => {
      const isPublic = new Reflector().get<boolean>(
        MetadataKeys.IsPublic,
        AuthController.prototype.refresh,
      );

      expect(isPublic).toBe(true);
    });
  });

  describe('register', () => {
    const dto: RegisterDto = {
      email: 'shopper@example.com',
      password: 'Correct Horse Battery 41!',
      fullName: 'Aisha Rahman',
    };

    it('answers with the pending-verification body', async () => {
      registrationService.register.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.register(dto)).resolves.toEqual({
        status: 'pending_verification',
      });
    });

    // The enumeration property itself — that a new address and an already-registered one
    // produce the identical response — is pinned a layer down, in
    // registration.service.spec.ts, which drives the two real repository outcomes apart. What
    // belongs here is a controller-only property: the body is the fixed constant, never
    // whatever the service happened to resolve as `data`. `data` on `register`'s real return
    // type is always `void`, so this mocks a value that could never occur in production —
    // deliberately, to prove the controller does not become a passthrough if that ever
    // changed. A prior version of this test instead called `register` twice with the same mock
    // and compared the two results to each other; that assertion holds for any deterministic
    // implementation, including a broken one, so it could never fail.
    it('returns the fixed body, never whatever the service resolved as data', async () => {
      registrationService.register.mockResolvedValue({
        ok: true,
        data: { leaked: 'should-never-appear' } as unknown as undefined,
      });

      await expect(controller.register(dto)).resolves.toEqual({
        status: 'pending_verification',
      });
    });

    it('propagates a policy rejection as a 400 carrying the policy message', async () => {
      registrationService.register.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Your password must be at least 12 characters.',
      });

      await expect(controller.register(dto)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });
  });

  describe('verifyEmail', () => {
    it('answers 200 with emailVerified true', async () => {
      emailVerificationService.verify.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.verifyEmail({ token: 'raw-token' })).resolves.toEqual({
        emailVerified: true,
      });
    });

    it('passes the token through without altering it', async () => {
      emailVerificationService.verify.mockResolvedValue({ ok: true, data: undefined });

      await controller.verifyEmail({ token: 'raw-token' });

      expect(emailVerificationService.verify).toHaveBeenCalledWith({
        token: 'raw-token',
        email: undefined,
        code: undefined,
      });
    });

    it('propagates the 400 for an invalid credential', async () => {
      emailVerificationService.verify.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'That verification link or code is not valid. Please request a new one.',
      });

      await expect(controller.verifyEmail({ token: 'nope' })).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });
  });

  describe('resendVerification', () => {
    it('answers with the pending-verification body, matching register', async () => {
      emailVerificationService.resend.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.resendVerification({ email: 'nobody@example.com' })).resolves.toEqual(
        { status: 'pending_verification' },
      );
    });

    // EmailVerificationService.resend always answers ok — see its own class comment — so this
    // branch does not occur in production. It is exercised anyway: unwrapOrThrow must still
    // convert a hypothetical failure into a thrown error rather than the controller silently
    // returning its fixed 202 body regardless of what the service reported.
    it('propagates a failure as an error rather than always returning the fixed body', async () => {
      emailVerificationService.resend.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(
        controller.resendVerification({ email: 'nobody@example.com' }),
      ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    });
  });

  describe('route protection', () => {
    // The counterpart to the refresh assertion above: `@CurrentUser()` is only ever undefined
    // on a `@Public()` route, so a session route that picked up the decorator would hand any
    // unauthenticated caller a listing rather than a 401.
    it.each([
      ['logout', AuthController.prototype.logout],
      ['logoutAll', AuthController.prototype.logoutAll],
      ['listSessions', AuthController.prototype.listSessions],
      ['deleteSession', AuthController.prototype.deleteSession],
      // Bearer, unlike the two enrolment routes: giving up a factor you already hold requires
      // a session, and an enrolment token must never be able to take one off.
      ['mfaDisable', AuthController.prototype.mfaDisable],
    ])('%s is not public', (_name, handler) => {
      const isPublic = new Reflector().get<boolean>(MetadataKeys.IsPublic, handler);

      expect(isPublic).toBeUndefined();
    });

    // The three routes below are unreachable any other way: the caller has no account, and
    // therefore no session, until one of these succeeds.
    it.each([
      ['register', AuthController.prototype.register],
      ['verifyEmail', AuthController.prototype.verifyEmail],
      ['resendVerification', AuthController.prototype.resendVerification],
    ])('%s is public, because the caller has no account yet', (_name, handler) => {
      expect(new Reflector().get<boolean>(MetadataKeys.IsPublic, handler)).toBe(true);
    });

    // The enrolment routes are the one case where `@Public()` is the requirement rather than a
    // risk: a staff account blocked from signing in until it enrols has no session to present,
    // so a guarded route here would make the flow unreachable — the F-C gap this closes.
    it.each([
      ['mfaSetup', AuthController.prototype.mfaSetup],
      ['mfaEnable', AuthController.prototype.mfaEnable],
    ])('%s is public, because the caller cannot yet have a session', (_name, handler) => {
      const isPublic = new Reflector().get<boolean>(MetadataKeys.IsPublic, handler);

      expect(isPublic).toBe(true);
    });
  });

  describe('mfaSetup', () => {
    const dto: MfaSetupDto = { enrolmentToken: 'enrol-token' };

    it('returns the secret and the otpauth URI', async () => {
      mfaService.setupForEnrolment.mockResolvedValue({
        ok: true,
        data: { secret: 'BASE32SECRET', otpauthUri: 'otpauth://totp/Barakah%20Bazaar:ops' },
      });

      const response = await controller.mfaSetup(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(response).toEqual({
        secret: 'BASE32SECRET',
        otpauthUri: 'otpauth://totp/Barakah%20Bazaar:ops',
      });
    });

    it('binds the enrolment to the device that asked', async () => {
      mfaService.setupForEnrolment.mockResolvedValue({
        ok: true,
        data: { secret: 'BASE32SECRET', otpauthUri: 'otpauth://totp/x' },
      });

      await controller.mfaSetup(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(mfaService.setupForEnrolment).toHaveBeenCalledWith('enrol-token', 'device-1');
    });

    it('rejects a request with no X-Device-Id header', async () => {
      await expect(controller.mfaSetup(dto, buildRequest({}))).rejects.toThrow(BadRequestException);
      expect(mfaService.setupForEnrolment).not.toHaveBeenCalled();
    });

    it('propagates a 401 for a token that did not verify', async () => {
      mfaService.setupForEnrolment.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidCredentials,
      });

      await expect(
        controller.mfaSetup(dto, buildRequest({ 'x-device-id': 'device-1' })),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    });
  });

  describe('mfaEnable', () => {
    const dto: MfaEnableDto = { enrolmentToken: 'enrol-token', code: '123456' };

    it('returns the recovery codes, which are readable exactly once', async () => {
      mfaService.enableForEnrolment.mockResolvedValue({
        ok: true,
        data: { recoveryCodes: ['aaaa', 'bbbb'] },
      });

      const response = await controller.mfaEnable(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(response).toEqual({ recoveryCodes: ['aaaa', 'bbbb'] });
    });

    it('issues no session — enrolling is not a second way to authenticate', async () => {
      mfaService.enableForEnrolment.mockResolvedValue({
        ok: true,
        data: { recoveryCodes: ['aaaa'] },
      });

      const response = await controller.mfaEnable(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(response).not.toHaveProperty('accessToken');
      expect(response).not.toHaveProperty('refreshToken');
      expect(sessionService.refresh).not.toHaveBeenCalled();
    });

    it('passes the token, device and code through', async () => {
      mfaService.enableForEnrolment.mockResolvedValue({
        ok: true,
        data: { recoveryCodes: [] },
      });

      await controller.mfaEnable(dto, buildRequest({ 'x-device-id': 'device-1' }));

      expect(mfaService.enableForEnrolment).toHaveBeenCalledWith(
        'enrol-token',
        'device-1',
        '123456',
      );
    });

    it('rejects a request with no X-Device-Id header', async () => {
      await expect(controller.mfaEnable(dto, buildRequest({}))).rejects.toThrow(
        BadRequestException,
      );
      expect(mfaService.enableForEnrolment).not.toHaveBeenCalled();
    });

    it('propagates a 400 when setup has not run', async () => {
      mfaService.enableForEnrolment.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: AuthMessages.MfaSetupRequired,
      });

      await expect(
        controller.mfaEnable(dto, buildRequest({ 'x-device-id': 'device-1' })),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });

  describe('mfaDisable', () => {
    const dto: MfaDisableDto = { password: 'correct horse battery staple', code: '123456' };

    it('turns the factor off for the authenticated caller', async () => {
      mfaService.disableForUser.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.mfaDisable(dto, authenticated)).resolves.toBeUndefined();
      expect(mfaService.disableForUser).toHaveBeenCalledWith(
        authenticated.userId,
        'correct horse battery staple',
        '123456',
      );
    });

    it('refuses an unauthenticated call rather than acting on nobody', async () => {
      await expect(controller.mfaDisable(dto, undefined)).rejects.toThrow(UnauthorizedException);
      expect(mfaService.disableForUser).not.toHaveBeenCalled();
    });

    it('propagates the 403 that keeps staff from opting out', async () => {
      mfaService.disableForUser.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: AuthMessages.MfaCannotBeDisabledForStaff,
      });

      await expect(controller.mfaDisable(dto, authenticated)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    });
  });
  describe('logout', () => {
    it('revokes the caller own session and answers 204', async () => {
      sessionService.revoke.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.logout(authenticated)).resolves.toBeUndefined();
      // The verified caller is handed along so the session service can record who signed
      // out without a second lookup.
      expect(sessionService.revoke).toHaveBeenCalledWith('session-1', {
        id: 'user-1',
        email: 'customer@example.com',
        role: UserRole.CUSTOMER,
      });
    });

    it('rejects a request with no verified caller', async () => {
      await expect(controller.logout(undefined)).rejects.toThrow(UnauthorizedException);
      expect(sessionService.revoke).not.toHaveBeenCalled();
    });

    it('propagates a service failure as the status the service reported', async () => {
      sessionService.revoke.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.logout(authenticated)).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });
  });

  describe('logoutAll', () => {
    it('reports how many sessions were revoked', async () => {
      sessionService.revokeAll.mockResolvedValue({ ok: true, data: 3 });

      await expect(controller.logoutAll(authenticated)).resolves.toEqual({ revoked: 3 });
      expect(sessionService.revokeAll).toHaveBeenCalledWith('user-1', {
        id: 'user-1',
        email: 'customer@example.com',
        role: UserRole.CUSTOMER,
      });
    });

    it('honestly reports zero when nothing was live', async () => {
      sessionService.revokeAll.mockResolvedValue({ ok: true, data: 0 });

      await expect(controller.logoutAll(authenticated)).resolves.toEqual({ revoked: 0 });
    });

    it('rejects a request with no verified caller', async () => {
      await expect(controller.logoutAll(undefined)).rejects.toThrow(UnauthorizedException);
      expect(sessionService.revokeAll).not.toHaveBeenCalled();
    });

    it('propagates a service failure as the status the service reported', async () => {
      sessionService.revokeAll.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.logoutAll(authenticated)).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });
  });

  describe('listSessions', () => {
    it('lists only the caller live sessions, mapped to the summary contract', async () => {
      const rows = [makeSession({ id: 'session-1' }), makeSession({ id: 'session-2' })];
      sessionService.listForUser.mockResolvedValue({ ok: true, data: rows });

      const response = await controller.listSessions(authenticated);

      expect(sessionService.listForUser).toHaveBeenCalledWith('user-1');
      expect(response).toHaveLength(2);
    });

    it('marks the caller current session, and only that one', async () => {
      const rows = [makeSession({ id: 'session-1' }), makeSession({ id: 'session-2' })];
      sessionService.listForUser.mockResolvedValue({ ok: true, data: rows });

      const response = await controller.listSessions(authenticated);

      expect(response.find((s) => s.id === 'session-1')?.current).toBe(true);
      expect(response.find((s) => s.id === 'session-2')?.current).toBe(false);
    });

    it('truncates the ip in the listing', async () => {
      sessionService.listForUser.mockResolvedValue({
        ok: true,
        data: [makeSession({ ipAddress: '203.0.113.42' })],
      });

      const response = await controller.listSessions(authenticated);

      expect(response[0].ipAddress).toBe('203.0.113.0');
    });

    it('returns no hash of any kind in a session listing', async () => {
      sessionService.listForUser.mockResolvedValue({
        ok: true,
        data: [
          makeSession({
            refreshTokenHash: 'sekrit-current',
            previousRefreshTokenHash: 'sekrit-previous',
          }),
        ],
      });

      const response = await controller.listSessions(authenticated);

      expect(JSON.stringify(response)).not.toContain('sekrit');
    });

    it('rejects a request with no verified caller', async () => {
      await expect(controller.listSessions(undefined)).rejects.toThrow(UnauthorizedException);
      expect(sessionService.listForUser).not.toHaveBeenCalled();
    });

    it('propagates a service failure as the status the service reported, and never returns a stale list', async () => {
      sessionService.listForUser.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.listSessions(authenticated)).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });
  });

  describe('deleteSession', () => {
    it('revokes the caller own session and answers 204', async () => {
      sessionService.revokeOwned.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.deleteSession(authenticated, 'session-1')).resolves.toBeUndefined();
      expect(sessionService.revokeOwned).toHaveBeenCalledWith('user-1', 'session-1');
    });

    it('deleting another user session answers 404, not 403', async () => {
      sessionService.revokeOwned.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Session was not found.',
      });

      await expect(
        controller.deleteSession(authenticated, 'someone-elses-session'),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('rejects a request with no verified caller, and never calls the service', async () => {
      await expect(controller.deleteSession(undefined, 'session-1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionService.revokeOwned).not.toHaveBeenCalled();
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

  describe('VerifyEmailDto validation', () => {
    it('accepts a token at the maximum allowed length', async () => {
      const errors = await validate(
        plainToInstance(VerifyEmailDto, {
          token: 'a'.repeat(AuthConstants.EmailVerificationTokenMaxLength),
        }),
      );

      expect(errors).toEqual([]);
    });

    it('rejects a token longer than the maximum allowed length', async () => {
      const errors = await validate(
        plainToInstance(VerifyEmailDto, {
          token: 'a'.repeat(AuthConstants.EmailVerificationTokenMaxLength + 1),
        }),
      );

      expect(errors).not.toEqual([]);
      expect(errors.some((error) => error.property === 'token')).toBe(true);
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

  describe('forgotPassword', () => {
    it('answers the reset-requested body whatever the service found', async () => {
      passwordResetService.request.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.forgotPassword({ email: 'shopper@example.com' })).resolves.toEqual({
        status: 'reset_requested',
      });
      expect(passwordResetService.request).toHaveBeenCalledWith('shopper@example.com');
    });

    it('propagates an unexpected failure status from the service', async () => {
      passwordResetService.request.mockResolvedValue({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });

      await expect(
        controller.forgotPassword({ email: 'shopper@example.com' }),
      ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
    });

    it('is public and joins both auth buckets', () => {
      const handler = AuthController.prototype.forgotPassword;

      expect(new Reflector().get<boolean>(MetadataKeys.IsPublic, handler)).toBe(true);
      expect(new Reflector().get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual([
        'auth-ip',
        'auth-account',
      ]);
    });
  });

  describe('resetPassword', () => {
    const byCode: ResetPasswordDto = {
      email: 'shopper@example.com',
      code: '481920',
      newPassword: 'Marbled Kingfisher 41!',
    };

    it('answers exactly { passwordReset: true } — no token of any kind', async () => {
      passwordResetService.reset.mockResolvedValue({ ok: true, data: undefined });

      const result = await controller.resetPassword(byCode);

      expect(result).toStrictEqual({ passwordReset: true });
    });

    it('passes every credential field and the new password through to the service', async () => {
      passwordResetService.reset.mockResolvedValue({ ok: true, data: undefined });

      await controller.resetPassword(byCode);

      expect(passwordResetService.reset).toHaveBeenCalledWith({
        token: undefined,
        email: 'shopper@example.com',
        code: '481920',
        newPassword: 'Marbled Kingfisher 41!',
      });
    });

    it('propagates the invalid-credential 400 with its message', async () => {
      passwordResetService.reset.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'That password reset link or code is not valid. Please request a new one.',
      });

      await expect(controller.resetPassword(byCode)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        message: 'That password reset link or code is not valid. Please request a new one.',
      });
    });

    it('propagates the attempt-cap 429', async () => {
      passwordResetService.reset.mockResolvedValue({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many incorrect codes. Please request a new password reset email.',
      });

      await expect(controller.resetPassword(byCode)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });

    it('is public and joins both auth buckets', () => {
      const handler = AuthController.prototype.resetPassword;

      expect(new Reflector().get<boolean>(MetadataKeys.IsPublic, handler)).toBe(true);
      // AuthAccount, keyed on the submitted email, is one of the three bounds on code brute
      // force (spec §6.3); AuthIp is the other half of §6.4's pair.
      expect(new Reflector().get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual([
        'auth-ip',
        'auth-account',
      ]);
    });
  });

  describe('changePassword', () => {
    const dto: ChangePasswordDto = {
      currentPassword: 'correct horse battery staple',
      newPassword: 'Marbled Kingfisher 41!',
    };

    it('passes the caller, their session and both passwords to the service', async () => {
      passwordChangeService.change.mockResolvedValue({ ok: true, data: undefined });

      await expect(controller.changePassword(dto, authenticated)).resolves.toBeUndefined();
      expect(passwordChangeService.change).toHaveBeenCalledWith(
        'user-1',
        'session-1',
        'correct horse battery staple',
        'Marbled Kingfisher 41!',
      );
    });

    it('propagates a wrong-current-password 401', async () => {
      passwordChangeService.change.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: 'Those sign-in details are not correct.',
      });

      await expect(controller.changePassword(dto, authenticated)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('rejects a request with no verified caller, and never calls the service', async () => {
      await expect(controller.changePassword(dto, undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwordChangeService.change).not.toHaveBeenCalled();
    });

    it('is not public, and joins the per-IP auth bucket', () => {
      const handler = AuthController.prototype.changePassword;

      expect(new Reflector().get<boolean>(MetadataKeys.IsPublic, handler)).toBeUndefined();
      expect(new Reflector().get<string[]>(MetadataKeys.RateLimitBuckets, handler)).toEqual([
        'auth-ip',
      ]);
    });
  });

  describe('ResetPasswordDto validation', () => {
    const newPassword = 'Marbled Kingfisher 41!';

    it('accepts a token alone', async () => {
      await expect(
        validate(plainToInstance(ResetPasswordDto, { token: 'abc', newPassword })),
      ).resolves.toEqual([]);
    });

    it('accepts an email and code', async () => {
      await expect(
        validate(
          plainToInstance(ResetPasswordDto, {
            email: 'shopper@example.com',
            code: '481920',
            newPassword,
          }),
        ),
      ).resolves.toEqual([]);
    });

    it('rejects both a token and a code', async () => {
      const errors = await validate(
        plainToInstance(ResetPasswordDto, { token: 'abc', code: '481920', newPassword }),
      );

      expect(errors.some((error) => error.constraints?.isExactlyOneOf)).toBe(true);
    });

    it('rejects neither a token nor a code', async () => {
      const errors = await validate(plainToInstance(ResetPasswordDto, { newPassword }));

      expect(errors.some((error) => error.constraints?.isExactlyOneOf)).toBe(true);
    });

    it('rejects a code that is not 6 digits', async () => {
      const errors = await validate(
        plainToInstance(ResetPasswordDto, {
          email: 'shopper@example.com',
          code: '48192',
          newPassword,
        }),
      );

      expect(errors.map((error) => error.property)).toContain('code');
    });

    it('rejects a token longer than 128 characters', async () => {
      const errors = await validate(
        plainToInstance(ResetPasswordDto, { token: 'a'.repeat(129), newPassword }),
      );

      expect(errors.map((error) => error.property)).toContain('token');
    });

    it('rejects a new password under 12 characters', async () => {
      const errors = await validate(
        plainToInstance(ResetPasswordDto, { token: 'abc', newPassword: 'Short1!' }),
      );

      expect(errors.map((error) => error.property)).toContain('newPassword');
    });
  });

  describe('ChangePasswordDto validation', () => {
    it('accepts a current password that a newer policy would refuse', async () => {
      await expect(
        validate(
          plainToInstance(ChangePasswordDto, {
            currentPassword: 'correct horse battery staple',
            newPassword: 'Marbled Kingfisher 41!',
          }),
        ),
      ).resolves.toEqual([]);
    });

    it('reports one error per required field when the payload is empty', async () => {
      const errors = await validate(plainToInstance(ChangePasswordDto, {}));

      expect(errors.map((error) => error.property).sort((a, b) => a.localeCompare(b))).toEqual([
        'currentPassword',
        'newPassword',
      ]);
    });

    it('rejects an empty current password', async () => {
      const errors = await validate(
        plainToInstance(ChangePasswordDto, {
          currentPassword: '',
          newPassword: 'Marbled Kingfisher 41!',
        }),
      );

      expect(errors.map((error) => error.property)).toEqual(['currentPassword']);
    });
  });
});

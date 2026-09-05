import { HttpStatus } from '@nestjs/common';
import { AuthEventsService } from './auth-events.service';
import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { Language, User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthMessages } from './auth.constants';
import { AuthRepository } from './auth.repository';
import { PasswordHasher } from './crypto/password-hasher';
import { LoginDto } from './dto/login.dto';
import { LoginService, portalFor } from './login.service';
import { AccessTokenService } from './tokens/access-token.service';
import {
  AUTH_SETTINGS_DEFAULTS,
  AuthSettingsService,
  ResolvedAuthSettings,
} from './settings/auth-settings.service';
import { SessionService } from './sessions/session.service';

const NOW = new Date('2026-09-03T00:00:00.000Z');

const userRow = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'customer@example.com',
  phone: null,
  fullName: 'Rahim Uddin',
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
  passwordHash: 'scrypt$32768$8$3$c2FsdA==$aGFzaA==',
  emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  passwordChangedAt: null,
  totpSecretEncrypted: null,
  totpEnabledAt: null,
  totpLastUsedStep: null,
  totpFailedAttempts: 0,
  totpFirstFailedAt: null,
  totpLockedUntil: null,
  role: UserRole.CUSTOMER,
  preferredLanguage: Language.BN,
  isActive: true,
  lastSeenAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const settingsRow = (overrides: Partial<ResolvedAuthSettings> = {}): ResolvedAuthSettings => ({
  ...AUTH_SETTINGS_DEFAULTS,
  ...overrides,
});

const dto: LoginDto = { email: 'customer@example.com', password: 'correct horse battery staple' };
const DEVICE_ID = 'device-1';
const jwtConfig = {
  JWT_SECRET: 'a'.repeat(32),
  JWT_ISSUER: 'barakah-bazaar-api',
  JWT_AUDIENCE: 'barakah-bazaar',
};

describe('LoginService', () => {
  let repository: { findByEmail: jest.Mock; updatePasswordHash: jest.Mock };
  let hasher: { verify: jest.Mock; needsRehash: jest.Mock; hash: jest.Mock };
  let settings: { current: jest.Mock };
  let tokens: { sign: jest.Mock };
  let sessions: { issue: jest.Mock };
  let events: {
    recordLogin: jest.Mock;
    recordNewDevice: jest.Mock;
    recordLoginFailed: jest.Mock;
    recordMfaFailed: jest.Mock;
    recordLogout: jest.Mock;
    recordSessionRevoked: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let service: LoginService;

  const issuedSession = {
    accessToken: 'access',
    expiresAt: new Date('2026-09-03T00:30:00.000Z'),
    refreshToken: 'refresh',
    refreshExpiresAt: new Date('2026-10-03T00:00:00.000Z'),
    user: userRow(),
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    repository = { findByEmail: jest.fn(), updatePasswordHash: jest.fn() };
    hasher = {
      verify: jest.fn().mockResolvedValue(true),
      needsRehash: jest.fn().mockReturnValue(false),
      hash: jest.fn().mockResolvedValue('scrypt$new'),
    };
    settings = { current: jest.fn().mockResolvedValue(settingsRow()) };
    tokens = { sign: jest.fn().mockResolvedValue('signed-token') };
    sessions = { issue: jest.fn().mockResolvedValue({ ok: true, data: issuedSession }) };
    events = {
      recordLogin: jest.fn().mockResolvedValue(undefined),
      recordNewDevice: jest.fn().mockResolvedValue(undefined),
      recordLoginFailed: jest.fn().mockResolvedValue(undefined),
      recordMfaFailed: jest.fn().mockResolvedValue(undefined),
      recordLogout: jest.fn().mockResolvedValue(undefined),
      recordSessionRevoked: jest.fn().mockResolvedValue(undefined),
    };
    logger = createMockLogger();

    service = new LoginService(
      repository as unknown as AuthRepository,
      hasher as unknown as PasswordHasher,
      settings as unknown as AuthSettingsService,
      tokens as unknown as AccessTokenService,
      sessions as unknown as SessionService,
      events as unknown as AuthEventsService,
      logger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues a session for a verified, active customer with the right password', async () => {
    repository.findByEmail.mockResolvedValue(userRow());

    const result = await service.login(dto, DEVICE_ID, 'ua', '203.0.113.7');

    expect(result).toEqual({
      ok: true,
      data: { kind: 'session', session: issuedSession, portal: 'STOREFRONT' },
    });
    expect(sessions.issue).toHaveBeenCalledWith(userRow(), DEVICE_ID, 'ua', '203.0.113.7');
  });

  it.each(Object.values(UserRole).map((role) => [role, portalFor(role)] as const))(
    'resolves portal %s -> %s',
    async (role, expectedPortal) => {
      repository.findByEmail.mockResolvedValue(userRow({ role }));
      sessions.issue.mockResolvedValue({
        ok: true,
        data: { ...issuedSession, user: userRow({ role }) },
      });
      // Staff MFA is required by default; disable it so staff roles reach session issuance too.
      settings.current.mockResolvedValue(settingsRow({ staffMfaRequired: false }));

      const result = await service.login(dto, DEVICE_ID, null, null);

      expect(result).toMatchObject({ ok: true, data: { kind: 'session', portal: expectedPortal } });
    },
  );

  it('answers the same 401 and message for an unknown email and a wrong password', async () => {
    repository.findByEmail.mockResolvedValue(undefined);
    const unknownEmailResult = await service.login(dto, DEVICE_ID, null, null);

    repository.findByEmail.mockResolvedValue(userRow());
    hasher.verify.mockResolvedValue(false);
    const wrongPasswordResult = await service.login(dto, DEVICE_ID, null, null);

    expect(unknownEmailResult).toEqual({
      ok: false,
      status: HttpStatus.UNAUTHORIZED,
      message: AuthMessages.InvalidCredentials,
    });
    expect(wrongPasswordResult).toEqual(unknownEmailResult);
  });

  it('records a failed password against the account it was aimed at', async () => {
    repository.findByEmail.mockResolvedValue(userRow());
    hasher.verify.mockResolvedValue(false);

    await service.login(dto, DEVICE_ID, 'jest', '203.0.113.42');

    expect(events.recordLoginFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ deviceId: DEVICE_ID, userAgent: 'jest', ip: '203.0.113.42' }),
    );
  });

  it('records nothing for an address with no account, so the log is not attacker-writable', async () => {
    repository.findByEmail.mockResolvedValue(undefined);

    await service.login(dto, DEVICE_ID, null, null);

    expect(events.recordLoginFailed).not.toHaveBeenCalled();
  });

  it('still runs a hash when no user is found, so timing does not leak existence', async () => {
    repository.findByEmail.mockResolvedValue(undefined);

    await service.login(dto, DEVICE_ID, null, null);

    expect(hasher.verify).toHaveBeenCalledWith(dto.password, PasswordHasher.DUMMY_HASH);
  });

  it('reports the email as unverified only after the password verifies', async () => {
    repository.findByEmail.mockResolvedValue(userRow({ emailVerifiedAt: null }));
    hasher.verify.mockResolvedValue(false);

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.UNAUTHORIZED,
      message: AuthMessages.InvalidCredentials,
    });
  });

  it('lets an unverified account in during the grace period', async () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    repository.findByEmail.mockResolvedValue(
      userRow({ emailVerifiedAt: null, createdAt: twoDaysAgo }),
    );

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toMatchObject({ ok: true, data: { kind: 'session' } });
  });

  it('blocks an unverified account past the grace period', async () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    repository.findByEmail.mockResolvedValue(
      userRow({ emailVerifiedAt: null, createdAt: eightDaysAgo }),
    );

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.FORBIDDEN,
      message: AuthMessages.EmailNotVerified,
    });
  });

  it('reports a disabled account only after the password verifies', async () => {
    repository.findByEmail.mockResolvedValue(userRow({ isActive: false }));

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.FORBIDDEN,
      message: ErrorMessages.AccountDisabled,
    });
    expect(hasher.verify).toHaveBeenCalled();
  });

  it('never reaches the disabled check when the password is wrong', async () => {
    repository.findByEmail.mockResolvedValue(userRow({ isActive: false }));
    hasher.verify.mockResolvedValue(false);

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });

  it('returns mfaRequired and no session when a factor is enrolled', async () => {
    repository.findByEmail.mockResolvedValue(userRow({ totpEnabledAt: new Date() }));

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({ ok: true, data: { kind: 'mfa', mfaToken: 'signed-token' } });
    expect(sessions.issue).not.toHaveBeenCalled();
    expect(tokens.sign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', deviceId: DEVICE_ID }),
      expect.any(Number),
      'mfa',
    );
  });

  it('returns enrolmentRequired for staff with MFA required and none enrolled', async () => {
    repository.findByEmail.mockResolvedValue(userRow({ role: UserRole.OPS }));
    settings.current.mockResolvedValue(settingsRow({ staffMfaRequired: true }));

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({
      ok: true,
      data: { kind: 'enrolment', enrolmentToken: 'signed-token' },
    });
    expect(sessions.issue).not.toHaveBeenCalled();
    expect(tokens.sign).toHaveBeenCalledWith(expect.anything(), expect.any(Number), 'enrolment');
  });

  it('does not require enrolment for a customer even when staffMfaRequired is set', async () => {
    repository.findByEmail.mockResolvedValue(userRow({ role: UserRole.CUSTOMER }));
    settings.current.mockResolvedValue(settingsRow({ staffMfaRequired: true }));

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toMatchObject({ ok: true, data: { kind: 'session' } });
  });

  it('rehashes the password when the stored parameters are weaker than configured', async () => {
    repository.findByEmail.mockResolvedValue(userRow());
    hasher.needsRehash.mockReturnValue(true);

    await service.login(dto, DEVICE_ID, null, null);

    expect(hasher.hash).toHaveBeenCalledWith(dto.password);
    expect(repository.updatePasswordHash).toHaveBeenCalledWith('user-1', 'scrypt$new');
  });

  it('does not fail the login when the rehash write fails', async () => {
    repository.findByEmail.mockResolvedValue(userRow());
    hasher.needsRehash.mockReturnValue(true);
    repository.updatePasswordHash.mockResolvedValue(null);

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toMatchObject({ ok: true, data: { kind: 'session' } });
  });

  it('does not fail the login when the rehash itself throws', async () => {
    repository.findByEmail.mockResolvedValue(userRow());
    hasher.needsRehash.mockReturnValue(true);
    hasher.hash.mockRejectedValue(new Error('scrypt exploded'));

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toMatchObject({ ok: true, data: { kind: 'session' } });
  });

  it('reports 503 when the user lookup fails', async () => {
    repository.findByEmail.mockResolvedValue(null);

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: ErrorMessages.ServiceUnavailable,
    });
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it('propagates a failed session issue rather than reporting success', async () => {
    repository.findByEmail.mockResolvedValue(userRow());
    sessions.issue.mockResolvedValue({
      ok: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: ErrorMessages.ServiceUnavailable,
    });

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: ErrorMessages.ServiceUnavailable,
    });
  });

  it('reports 500 and logs when an unexpected exception is thrown', async () => {
    const failure = new Error('boom');
    repository.findByEmail.mockRejectedValue(failure);

    const result = await service.login(dto, DEVICE_ID, null, null);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: ErrorMessages.UnexpectedError,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      'Exception occurred in LoginService.login',
    );
  });

  it('never logs the password', async () => {
    repository.findByEmail.mockRejectedValue(new Error('boom'));
    hasher.needsRehash.mockReturnValue(true);
    hasher.hash.mockRejectedValue(new Error('scrypt exploded'));

    await service.login(dto, DEVICE_ID, null, null);

    const allLoggedArguments = [
      ...logger.error.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.info.mock.calls,
      ...logger.debug.mock.calls,
    ].flat();

    for (const argument of allLoggedArguments) {
      expect(JSON.stringify(argument)).not.toContain(dto.password);
    }
  });

  describe('the mfa token cannot be used where an access token is required', () => {
    it('signs a token that verifies as "mfa" but not as "access"', async () => {
      // Real AccessTokenService, not a mock, so this proves the actual JWT `typ` claim rather
      // than merely the argument LoginService happened to pass to a stub.
      const realTokens = new AccessTokenService(createMockConfig(jwtConfig), logger);
      const realService = new LoginService(
        repository as unknown as AuthRepository,
        hasher as unknown as PasswordHasher,
        settings as unknown as AuthSettingsService,
        realTokens,
        sessions as unknown as SessionService,
        events as unknown as AuthEventsService,
        logger,
      );
      repository.findByEmail.mockResolvedValue(userRow({ totpEnabledAt: new Date() }));

      const result = await realService.login(dto, DEVICE_ID, null, null);
      if (!result.ok || result.data.kind !== 'mfa') {
        throw new Error('expected an mfa result');
      }
      const { mfaToken } = result.data;

      await expect(realTokens.verify(mfaToken, DEVICE_ID, 'mfa')).resolves.toMatchObject({
        ok: true,
      });
      // Refused as an access token, and — because the `typ` check runs before the binding
      // one — naming no session, so presenting it at the guard cannot end anything.
      await expect(realTokens.verify(mfaToken, DEVICE_ID, 'access')).resolves.toEqual({
        ok: false,
      });
    });

    // The cross-service contract that makes staff enrolment reachable at all: `login` signs
    // the enrolment token and `MfaService.setupForEnrolment` verifies it as `'enrolment'`.
    // Both halves are proved against the real token service, because a stub would agree with
    // whatever string each side happened to pass and the flow would still dead-end in
    // production — which is exactly how it dead-ended before.
    it('signs an enrolment token that verifies as "enrolment" but not as "access" or "mfa"', async () => {
      const realTokens = new AccessTokenService(createMockConfig(jwtConfig), logger);
      const realService = new LoginService(
        repository as unknown as AuthRepository,
        hasher as unknown as PasswordHasher,
        settings as unknown as AuthSettingsService,
        realTokens,
        sessions as unknown as SessionService,
        events as unknown as AuthEventsService,
        logger,
      );
      settings.current.mockResolvedValue(settingsRow({ staffMfaRequired: true }));
      repository.findByEmail.mockResolvedValue(
        userRow({ role: UserRole.OPS, totpEnabledAt: null }),
      );

      const result = await realService.login(dto, DEVICE_ID, null, null);
      if (!result.ok || result.data.kind !== 'enrolment') {
        throw new Error('expected an enrolment result');
      }
      const { enrolmentToken } = result.data;

      await expect(
        realTokens.verify(enrolmentToken, DEVICE_ID, 'enrolment'),
      ).resolves.toMatchObject({ ok: true });
      await expect(realTokens.verify(enrolmentToken, DEVICE_ID, 'access')).resolves.toEqual({
        ok: false,
      });
      await expect(realTokens.verify(enrolmentToken, DEVICE_ID, 'mfa')).resolves.toEqual({
        ok: false,
      });
    });
  });
});

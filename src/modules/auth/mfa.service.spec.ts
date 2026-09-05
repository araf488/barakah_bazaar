import { HttpStatus } from '@nestjs/common';
import { AuthEventsService } from './auth-events.service';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { Language, User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthConstants, AuthMessages } from './auth.constants';
import { AuthRepository } from './auth.repository';
import { MfaCryptoSupport, MfaService } from './mfa.service';
import {
  AUTH_SETTINGS_DEFAULTS,
  AuthSettingsService,
  ResolvedAuthSettings,
} from './settings/auth-settings.service';
import { SessionService } from './sessions/session.service';
import { AccessTokenService } from './tokens/access-token.service';

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
  totpSecretEncrypted: 'sealed-secret',
  totpEnabledAt: new Date('2026-01-01T00:00:00.000Z'),
  totpLastUsedStep: 10,
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

const DEVICE_ID = 'device-1';

describe('MfaService', () => {
  let repository: {
    findById: jest.Mock;
    saveTotpSecret: jest.Mock;
    enableTotp: jest.Mock;
    disableTotp: jest.Mock;
    recordTotpFailure: jest.Mock;
    resetTotpState: jest.Mock;
    findUnusedRecoveryCode: jest.Mock;
    burnRecoveryCode: jest.Mock;
  };
  let crypto: {
    cipher: { encrypt: jest.Mock; decrypt: jest.Mock };
    totp: { generateSecret: jest.Mock; buildUri: jest.Mock; verify: jest.Mock };
    hasher: { verify: jest.Mock };
  };
  let tokens: { verify: jest.Mock };
  let sessions: { issue: jest.Mock };
  let settings: { current: jest.Mock };
  let events: {
    recordLogin: jest.Mock;
    recordNewDevice: jest.Mock;
    recordLoginFailed: jest.Mock;
    recordMfaFailed: jest.Mock;
    recordLogout: jest.Mock;
    recordSessionRevoked: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let service: MfaService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    repository = {
      findById: jest.fn(),
      saveTotpSecret: jest.fn(),
      enableTotp: jest.fn(),
      disableTotp: jest.fn(),
      recordTotpFailure: jest.fn(),
      resetTotpState: jest.fn(),
      findUnusedRecoveryCode: jest.fn(),
      burnRecoveryCode: jest.fn(),
    };
    crypto = {
      cipher: {
        encrypt: jest.fn().mockReturnValue('sealed-secret'),
        decrypt: jest.fn().mockReturnValue('plain-secret'),
      },
      totp: {
        generateSecret: jest.fn().mockReturnValue('plain-secret'),
        buildUri: jest.fn().mockReturnValue('otpauth://totp/...'),
        verify: jest.fn().mockReturnValue({ ok: true, step: 11 }),
      },
      hasher: { verify: jest.fn().mockResolvedValue(true) },
    };
    tokens = {
      verify: jest.fn().mockResolvedValue({
        ok: true,
        claims: {
          userId: 'user-1',
          sessionId: '',
          role: UserRole.CUSTOMER,
          email: 'customer@example.com',
          type: 'mfa',
        },
      }),
    };
    sessions = {
      issue: jest.fn().mockResolvedValue({
        ok: true,
        data: {
          accessToken: 'access',
          expiresAt: new Date(),
          refreshToken: 'refresh',
          refreshExpiresAt: new Date(),
          user: userRow(),
        },
      }),
    };
    settings = { current: jest.fn().mockResolvedValue(settingsRow()) };
    events = {
      recordLogin: jest.fn().mockResolvedValue(undefined),
      recordNewDevice: jest.fn().mockResolvedValue(undefined),
      recordLoginFailed: jest.fn().mockResolvedValue(undefined),
      recordMfaFailed: jest.fn().mockResolvedValue(undefined),
      recordLogout: jest.fn().mockResolvedValue(undefined),
      recordSessionRevoked: jest.fn().mockResolvedValue(undefined),
    };
    logger = createMockLogger();

    service = new MfaService(
      repository as unknown as AuthRepository,
      crypto as unknown as MfaCryptoSupport,
      tokens as unknown as AccessTokenService,
      sessions as unknown as SessionService,
      settings as unknown as AuthSettingsService,
      events as unknown as AuthEventsService,
      logger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('setup', () => {
    it('generates, encrypts and stores a new secret', async () => {
      repository.saveTotpSecret.mockResolvedValue(userRow());

      const result = await service.setup(userRow());

      expect(result).toEqual({
        ok: true,
        data: { secret: 'plain-secret', otpauthUri: 'otpauth://totp/...' },
      });
      expect(crypto.cipher.encrypt).toHaveBeenCalledWith('plain-secret');
      expect(repository.saveTotpSecret).toHaveBeenCalledWith('user-1', 'sealed-secret');
    });

    it('reports 503 when the write fails', async () => {
      repository.saveTotpSecret.mockResolvedValue(null);

      const result = await service.setup(userRow());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: ErrorMessages.ServiceUnavailable,
      });
    });

    it('never logs the generated secret', async () => {
      repository.saveTotpSecret.mockRejectedValue(new Error('boom'));

      await service.setup(userRow());

      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain('plain-secret');
    });
  });

  describe('enable', () => {
    it('confirms the secret and returns ten recovery codes', async () => {
      repository.enableTotp.mockResolvedValue(userRow({ totpEnabledAt: new Date() }));

      const result = await service.enable(userRow(), '123456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.recoveryCodes).toHaveLength(AuthConstants.TotpRecoveryCodeCount);
        expect(new Set(result.data.recoveryCodes).size).toBe(AuthConstants.TotpRecoveryCodeCount);
      }
      expect(repository.enableTotp).toHaveBeenCalledWith('user-1', 11, expect.any(Array));
    });

    it('rejects when no secret has been set up', async () => {
      crypto.cipher.decrypt.mockReturnValue(null);

      const result = await service.enable(userRow({ totpSecretEncrypted: null }), '123456');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: AuthMessages.MfaSetupRequired,
      });
    });

    it('rejects a wrong code without enabling', async () => {
      crypto.totp.verify.mockReturnValue({ ok: false, step: 11 });

      const result = await service.enable(userRow(), '000000');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidMfaCode,
      });
      expect(repository.enableTotp).not.toHaveBeenCalled();
    });
  });

  describe('verifyLogin', () => {
    it('issues a session for a correct code', async () => {
      repository.findById.mockResolvedValue(userRow());

      const result = await service.verifyLogin(
        'mfa-token',
        { code: '123456' },
        DEVICE_ID,
        'ua',
        '203.0.113.7',
      );

      expect(result.ok).toBe(true);
      expect(sessions.issue).toHaveBeenCalledWith(userRow(), DEVICE_ID, 'ua', '203.0.113.7');
      expect(repository.resetTotpState).toHaveBeenCalledWith('user-1', 11);
    });

    it('records a wrong second factor, which is a stronger signal than a wrong password', async () => {
      repository.findById.mockResolvedValue(userRow());
      crypto.totp.verify.mockReturnValue({ ok: false });

      await service.verifyLogin('mfa-token', { code: '000000' }, DEVICE_ID, 'ua', '203.0.113.7');

      expect(events.recordMfaFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        expect.objectContaining({ deviceId: DEVICE_ID, userAgent: 'ua', ip: '203.0.113.7' }),
      );
    });

    it('records nothing when the code was right', async () => {
      repository.findById.mockResolvedValue(userRow());

      await service.verifyLogin('mfa-token', { code: '123456' }, DEVICE_ID, 'ua', null);

      expect(events.recordMfaFailed).not.toHaveBeenCalled();
    });

    it('rejects an invalid or expired mfa token', async () => {
      tokens.verify.mockResolvedValue({ ok: false });

      const result = await service.verifyLogin(
        'bad-token',
        { code: '123456' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidCredentials,
      });
      expect(sessions.issue).not.toHaveBeenCalled();
    });

    it('rejects a token verified as "access" rather than "mfa"', async () => {
      // AccessTokenService.verify already refuses to return claims for the wrong `typ`; this
      // asserts MfaService relies on exactly that call rather than skipping it.
      await service.verifyLogin('some-token', { code: '123456' }, DEVICE_ID, null, null);

      expect(tokens.verify).toHaveBeenCalledWith('some-token', DEVICE_ID, 'mfa');
    });

    it('rejects a wrong code, incrementing the failure counter', async () => {
      repository.findById.mockResolvedValue(
        userRow({ totpFailedAttempts: 1, totpFirstFailedAt: new Date(Date.now() - 60_000) }),
      );
      crypto.totp.verify.mockReturnValue({ ok: false, step: 11 });

      const result = await service.verifyLogin(
        'mfa-token',
        { code: '000000' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidMfaCode,
      });
      expect(repository.recordTotpFailure).toHaveBeenCalledWith(
        'user-1',
        2,
        null,
        expect.any(Date),
      );
      expect(sessions.issue).not.toHaveBeenCalled();
    });

    it('locks the account once the failure count reaches the ceiling', async () => {
      repository.findById.mockResolvedValue(
        userRow({
          totpFailedAttempts: AuthConstants.TotpMaxFailedAttempts - 1,
          totpFirstFailedAt: new Date(Date.now() - 60_000),
        }),
      );
      crypto.totp.verify.mockReturnValue({ ok: false, step: 11 });

      await service.verifyLogin('mfa-token', { code: '000000' }, DEVICE_ID, null, null);

      expect(repository.recordTotpFailure).toHaveBeenCalledWith(
        'user-1',
        AuthConstants.TotpMaxFailedAttempts,
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('starts a fresh run when the earlier failures are older than the window', async () => {
      // The rule is "five within an hour", not "five ever". Without this, five fumbles
      // spread across months would lock an account nobody was attacking.
      const longAgo = new Date(
        Date.now() -
          (AuthConstants.TotpFailureWindowMinutes + 1) * AuthConstants.MillisecondsPerMinute,
      );
      repository.findById.mockResolvedValue(
        userRow({
          totpFailedAttempts: AuthConstants.TotpMaxFailedAttempts - 1,
          totpFirstFailedAt: longAgo,
        }),
      );
      crypto.totp.verify.mockReturnValue({ ok: false, step: 11 });

      await service.verifyLogin('mfa-token', { code: '000000' }, DEVICE_ID, null, null);

      const [, attempts, lockedUntil, firstFailedAt] = repository.recordTotpFailure.mock
        .calls[0] as [string, number, Date | null, Date | null];

      expect(attempts).toBe(1);
      expect(lockedUntil).toBeNull();
      expect(firstFailedAt).not.toEqual(longAgo);
    });

    it('counts failures that fall inside the window', async () => {
      const recently = new Date(
        Date.now() -
          (AuthConstants.TotpFailureWindowMinutes - 1) * AuthConstants.MillisecondsPerMinute,
      );
      repository.findById.mockResolvedValue(
        userRow({ totpFailedAttempts: 2, totpFirstFailedAt: recently }),
      );
      crypto.totp.verify.mockReturnValue({ ok: false, step: 11 });

      await service.verifyLogin('mfa-token', { code: '000000' }, DEVICE_ID, null, null);

      // The run keeps its original start, so the window does not slide forward with each
      // failure — otherwise a slow drip of wrong codes would never expire.
      expect(repository.recordTotpFailure).toHaveBeenCalledWith('user-1', 3, null, recently);
    });

    it('starts a fresh run after a lockout has been served', async () => {
      // Otherwise the first attempt after serving fifteen minutes re-locks immediately, and
      // one bad evening becomes a cycle nobody can get out of.
      repository.findById.mockResolvedValue(
        userRow({
          totpFailedAttempts: AuthConstants.TotpMaxFailedAttempts,
          totpFirstFailedAt: new Date(Date.now() - 60_000),
          totpLockedUntil: new Date(Date.now() - 1_000),
        }),
      );
      crypto.totp.verify.mockReturnValue({ ok: false, step: 11 });

      await service.verifyLogin('mfa-token', { code: '000000' }, DEVICE_ID, null, null);

      expect(repository.recordTotpFailure).toHaveBeenCalledWith(
        'user-1',
        1,
        null,
        expect.any(Date),
      );
    });

    it('blocks verification while locked out, without checking the code at all', async () => {
      repository.findById.mockResolvedValue(
        userRow({ totpLockedUntil: new Date(NOW.getTime() + 60_000) }),
      );

      const result = await service.verifyLogin(
        'mfa-token',
        { code: '123456' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: AuthMessages.MfaLocked,
      });
      expect(crypto.totp.verify).not.toHaveBeenCalled();
      expect(sessions.issue).not.toHaveBeenCalled();
    });

    it('allows verification again once the lockout has expired', async () => {
      repository.findById.mockResolvedValue(
        userRow({ totpLockedUntil: new Date(NOW.getTime() - 1) }),
      );

      const result = await service.verifyLogin(
        'mfa-token',
        { code: '123456' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result.ok).toBe(true);
    });

    it('accepts a valid recovery code and burns it', async () => {
      repository.findById.mockResolvedValue(userRow());
      repository.findUnusedRecoveryCode.mockResolvedValue({ id: 'code-1' });

      const result = await service.verifyLogin(
        'mfa-token',
        { recoveryCode: 'abc123' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result.ok).toBe(true);
      expect(repository.burnRecoveryCode).toHaveBeenCalledWith('code-1');
    });

    it('rejects an already-used or unknown recovery code', async () => {
      repository.findById.mockResolvedValue(userRow());
      repository.findUnusedRecoveryCode.mockResolvedValue(undefined);

      const result = await service.verifyLogin(
        'mfa-token',
        { recoveryCode: 'not-a-real-code' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidMfaCode,
      });
      expect(repository.burnRecoveryCode).not.toHaveBeenCalled();
    });

    it('reports 503 when the user lookup fails', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.verifyLogin(
        'mfa-token',
        { code: '123456' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: ErrorMessages.ServiceUnavailable,
      });
    });

    it('rejects a user with no TOTP secret configured', async () => {
      repository.findById.mockResolvedValue(userRow({ totpSecretEncrypted: null }));

      const result = await service.verifyLogin(
        'mfa-token',
        { code: '123456' },
        DEVICE_ID,
        null,
        null,
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidCredentials,
      });
    });

    it('never logs the presented code', async () => {
      repository.findById.mockRejectedValue(new Error('boom'));

      await service.verifyLogin('mfa-token', { code: '999999' }, DEVICE_ID, null, null);

      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('999999');
    });
  });

  describe('disable', () => {
    it('turns MFA off for a customer with the right password and code', async () => {
      repository.disableTotp.mockResolvedValue(userRow({ totpEnabledAt: null }));

      const result = await service.disable(userRow(), 'correct password', '123456');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.disableTotp).toHaveBeenCalledWith('user-1');
    });

    it('rejects a wrong password before checking anything else', async () => {
      crypto.hasher.verify.mockResolvedValue(false);

      const result = await service.disable(userRow(), 'wrong password', '123456');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidCredentials,
      });
      expect(repository.disableTotp).not.toHaveBeenCalled();
    });

    it('refuses to disable for staff while staffMfaRequired is set', async () => {
      settings.current.mockResolvedValue(settingsRow({ staffMfaRequired: true }));

      const result = await service.disable(
        userRow({ role: UserRole.OPS }),
        'correct password',
        '123456',
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: AuthMessages.MfaCannotBeDisabledForStaff,
      });
      expect(repository.disableTotp).not.toHaveBeenCalled();
    });

    it('allows staff to disable once staffMfaRequired is turned off', async () => {
      settings.current.mockResolvedValue(settingsRow({ staffMfaRequired: false }));
      repository.disableTotp.mockResolvedValue(
        userRow({ role: UserRole.OPS, totpEnabledAt: null }),
      );

      const result = await service.disable(
        userRow({ role: UserRole.OPS }),
        'correct password',
        '123456',
      );

      expect(result.ok).toBe(true);
    });

    it('rejects a wrong TOTP code', async () => {
      crypto.totp.verify.mockReturnValue({ ok: false, step: 11 });

      const result = await service.disable(userRow(), 'correct password', '000000');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: AuthMessages.InvalidMfaCode,
      });
      expect(repository.disableTotp).not.toHaveBeenCalled();
    });

    it('never logs the password', async () => {
      repository.disableTotp.mockRejectedValue(new Error('boom'));

      await service.disable(userRow(), 'super-secret-password', '123456');

      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('super-secret-password');
    });
  });
});

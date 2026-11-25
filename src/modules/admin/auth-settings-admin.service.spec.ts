import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { SessionCachePort } from '../auth/sessions/session-cache.port';
import { AuthSettingsService } from '../auth/settings/auth-settings.service';
import { AuthSettingsAdminRepository } from './auth-settings-admin.repository';
import { AuthSettingsAdminService } from './auth-settings-admin.service';
import { UpdateAuthSettingsDto } from './dto/auth-settings.dto';

const superAdmin: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'boss@barakahbazaar.com.bd',
  role: UserRole.SUPER_ADMIN,
};

const defaults = {
  accessTokenMinutes: 30,
  customerRefreshIdleMinutes: 43200,
  customerRefreshAbsoluteMinutes: 129600,
  staffRefreshIdleMinutes: 720,
  staffRefreshAbsoluteMinutes: 10080,
  staffMfaRequired: true,
  emailVerificationGraceHours: 168,
  refreshReuseGraceSeconds: 30,
};

const updatedAt = new Date('2026-10-01T00:00:00.000Z');

describe('AuthSettingsAdminService', () => {
  let repository: { writeAudited: jest.Mock };
  let authSettings: { resolveWithFallbacks: jest.Mock; invalidate: jest.Mock };
  let authService: { resolveActiveUserId: jest.Mock };
  let sessionCache: { invalidateUser: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AuthSettingsAdminService;

  /**
   * Runs the audit builder the service handed the repository, as the real one would, with the
   * revoke count the repository would have passed it.
   */
  const auditOf = (call = 0, revokedStaffSessions = 0) => {
    const [data, expected, audit, options] = repository.writeAudited.mock.calls[call] as [
      unknown,
      Date | null,
      (row: unknown, revoked: number) => Record<string, unknown>,
      { revokeStaffSessions?: boolean } | undefined,
    ];
    return {
      data,
      expected,
      options,
      row: audit({ id: 'singleton', ...(data as object), updatedAt }, revokedStaffSessions),
    };
  };

  /** The effective settings as read, with staff MFA off. */
  const mfaOffRead = () => ({
    settings: { ...defaults, staffMfaRequired: false },
    fallbacks: [],
    updatedAt,
    storedFallbackValues: {},
  });

  beforeEach(() => {
    repository = {
      writeAudited: jest.fn((data: object) =>
        Promise.resolve({
          kind: 'written',
          row: { id: 'singleton', ...data, updatedAt },
          revokedStaffSessions: 0,
          revokedStaffUserIds: [],
        }),
      ),
    };
    sessionCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    authSettings = {
      resolveWithFallbacks: jest.fn().mockResolvedValue({
        settings: defaults,
        fallbacks: [],
        updatedAt,
        storedFallbackValues: {},
      }),
      invalidate: jest.fn(),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new AuthSettingsAdminService(
      repository as unknown as AuthSettingsAdminRepository,
      authSettings as unknown as AuthSettingsService,
      authService as unknown as AuthService,
      createMockConfig({ AUTH_SETTINGS_CACHE_SECONDS: 60 }),
      sessionCache as unknown as SessionCachePort,
      logger,
    );
  });

  describe('view', () => {
    it('returns the effective settings, the fallen-back fields and the write time', async () => {
      authSettings.resolveWithFallbacks.mockResolvedValue({
        settings: defaults,
        fallbacks: ['accessTokenMinutes'],
        updatedAt,
      });

      await expect(service.view()).resolves.toEqual({
        ok: true,
        data: { settings: defaults, fallbacks: ['accessTokenMinutes'], updatedAt },
      });
    });

    it('returns 503 when the settings could not be read', async () => {
      authSettings.resolveWithFallbacks.mockResolvedValue(null);

      await expect(service.view()).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('returns 500 and logs when the read throws', async () => {
      authSettings.resolveWithFallbacks.mockRejectedValue(new Error('boom'));

      await expect(service.view()).resolves.toEqual(
        expect.objectContaining({ ok: false, status: HttpStatus.INTERNAL_SERVER_ERROR }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Exception occurred in AuthSettingsAdminService.view',
      );
    });
  });

  describe('update', () => {
    it('refuses an empty body with 400 and writes nothing', async () => {
      await expect(service.update(superAdmin, {})).resolves.toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Nothing to change.',
      });
      expect(repository.writeAudited).not.toHaveBeenCalled();
      expect(authSettings.invalidate).not.toHaveBeenCalled();
    });

    it('treats a body carrying only the confirmation flag as nothing to change', async () => {
      await expect(service.update(superAdmin, { confirmDisableStaffMfa: true })).resolves.toEqual(
        expect.objectContaining({ status: HttpStatus.BAD_REQUEST }),
      );
      expect(repository.writeAudited).not.toHaveBeenCalled();
    });

    it('passes an unresolvable actor straight back without writing', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'nope',
      });

      await expect(service.update(superAdmin, { accessTokenMinutes: 45 })).resolves.toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'nope',
      });
      expect(repository.writeAudited).not.toHaveBeenCalled();
    });

    it('refuses an invalid combination with the literal rule message', async () => {
      await expect(
        service.update(superAdmin, { accessTokenMinutes: 60, staffRefreshIdleMinutes: 45 }),
      ).resolves.toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'staffRefreshIdleMinutes must be greater than accessTokenMinutes (60).',
      });
      expect(repository.writeAudited).not.toHaveBeenCalled();
    });

    it('joins several violations with a single space', async () => {
      await expect(
        service.update(superAdmin, {
          accessTokenMinutes: 60,
          staffRefreshIdleMinutes: 45,
          refreshReuseGraceSeconds: 500,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          message:
            'staffRefreshIdleMinutes must be greater than accessTokenMinutes (60). ' +
            'refreshReuseGraceSeconds must be a whole number from 0 to 120.',
        }),
      );
    });

    it('refuses to turn staff MFA off without the confirmation flag', async () => {
      await expect(service.update(superAdmin, { staffMfaRequired: false })).resolves.toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Turning off two-factor authentication for staff needs explicit confirmation.',
      });
      expect(repository.writeAudited).not.toHaveBeenCalled();
    });

    it('turns staff MFA off with the flag and records it as its own action', async () => {
      const result = await service.update(superAdmin, {
        staffMfaRequired: false,
        confirmDisableStaffMfa: true,
      });

      expect(result).toEqual({
        ok: true,
        data: {
          settings: { ...defaults, staffMfaRequired: false },
          propagatesWithinSeconds: 60,
          staffSessionsRevoked: 0,
        },
      });
      expect(auditOf().options).toEqual({ revokeStaffSessions: false });
      const { data, row } = auditOf();
      expect(data).toEqual({ ...defaults, staffMfaRequired: false });
      expect(row).toEqual({
        actorId: 'user-1',
        actorEmail: 'boss@barakahbazaar.com.bd',
        actorRole: UserRole.SUPER_ADMIN,
        action: 'auth.staff_mfa_disabled',
        entityType: 'AuthSettings',
        entityId: 'singleton',
        before: defaults,
        after: { ...defaults, staffMfaRequired: false },
        requestId: null,
      });
    });

    describe('turning staff MFA back on', () => {
      beforeEach(() => {
        authSettings.resolveWithFallbacks.mockResolvedValue(mfaOffRead());
        repository.writeAudited.mockImplementation((data: object) =>
          Promise.resolve({
            kind: 'written',
            row: { id: 'singleton', ...data, updatedAt },
            revokedStaffSessions: 4,
            revokedStaffUserIds: ['staff-1', 'staff-2'],
          }),
        );
      });

      it('bumps the session-cache generation of each revoked owner, once, after the write', async () => {
        await service.update(superAdmin, { staffMfaRequired: true });

        expect(sessionCache.invalidateUser).toHaveBeenCalledTimes(2);
        expect(sessionCache.invalidateUser).toHaveBeenNthCalledWith(1, 'staff-1');
        expect(sessionCache.invalidateUser).toHaveBeenNthCalledWith(2, 'staff-2');
        expect(sessionCache.invalidateUser.mock.invocationCallOrder[0]).toBeGreaterThan(
          repository.writeAudited.mock.invocationCallOrder[0],
        );
      });

      it('still answers 200 and bumps the rest when one bump fails, logging it at warn', async () => {
        sessionCache.invalidateUser
          .mockRejectedValueOnce(new Error('redis down'))
          .mockResolvedValueOnce(undefined);

        const result = await service.update(superAdmin, { staffMfaRequired: true });

        expect(result).toEqual({
          ok: true,
          data: { settings: defaults, propagatesWithinSeconds: 60, staffSessionsRevoked: 4 },
        });
        expect(sessionCache.invalidateUser).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          { err: expect.any(Error), userId: 'staff-1' },
          'Session-cache user-generation bump failed after a staff session revoke',
        );
        expect(authSettings.invalidate).toHaveBeenCalledTimes(1);
      });

      it('treats a bump that throws synchronously the same way', async () => {
        sessionCache.invalidateUser.mockImplementationOnce(() => {
          throw new Error('not connected');
        });

        const result = await service.update(superAdmin, { staffMfaRequired: true });

        expect(result.ok).toBe(true);
        expect(sessionCache.invalidateUser).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);
      });

      it('asks the write to revoke staff sessions and reports the count', async () => {
        const result = await service.update(superAdmin, { staffMfaRequired: true });

        expect(result).toEqual({
          ok: true,
          data: { settings: defaults, propagatesWithinSeconds: 60, staffSessionsRevoked: 4 },
        });
        expect(auditOf().options).toEqual({ revokeStaffSessions: true });
      });

      it('audits it as its own action with the revoked count in after', async () => {
        await service.update(superAdmin, { staffMfaRequired: true });

        expect(auditOf(0, 4).row).toEqual({
          actorId: 'user-1',
          actorEmail: 'boss@barakahbazaar.com.bd',
          actorRole: UserRole.SUPER_ADMIN,
          action: 'auth.staff_mfa_enabled',
          entityType: 'AuthSettings',
          entityId: 'singleton',
          before: { ...defaults, staffMfaRequired: false },
          after: { ...defaults, revokedStaffSessions: 4 },
          requestId: null,
        });
      });

      it('logs the count once the write committed', async () => {
        await service.update(superAdmin, { staffMfaRequired: true });

        expect(logger.info).toHaveBeenCalledWith(
          { revokedStaffSessions: 4 },
          'Staff sessions revoked because staff MFA was turned back on',
        );
      });

      it('revokes nothing and reports nothing on a conflict', async () => {
        repository.writeAudited.mockResolvedValue({ kind: 'conflict' });

        await expect(service.update(superAdmin, { staffMfaRequired: true })).resolves.toEqual(
          expect.objectContaining({ ok: false, status: HttpStatus.CONFLICT }),
        );
        expect(authSettings.invalidate).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
        expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
      });

      it('bumps nothing when the write faulted', async () => {
        repository.writeAudited.mockResolvedValue(null);

        await service.update(superAdmin, { staffMfaRequired: true });

        expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
      });

      it('does not revoke when the PATCH leaves staffMfaRequired out', async () => {
        await service.update(superAdmin, { accessTokenMinutes: 45 });

        expect(auditOf().options).toEqual({ revokeStaffSessions: false });
        expect(auditOf().row.action).toBe('auth.settings_updated');
        expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
      });
    });

    it('does not revoke when staff MFA was already on (true to true)', async () => {
      const result = await service.update(superAdmin, { staffMfaRequired: true });

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ staffSessionsRevoked: 0 }),
        }),
      );
      expect(auditOf().options).toEqual({ revokeStaffSessions: false });
      expect(auditOf().row.action).toBe('auth.settings_updated');
      expect(auditOf().row.after).not.toHaveProperty('revokedStaffSessions');
      expect(sessionCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('needs no confirmation when MFA is already off, and records an ordinary update', async () => {
      authSettings.resolveWithFallbacks.mockResolvedValue(mfaOffRead());

      const result = await service.update(superAdmin, { staffMfaRequired: false });

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ staffSessionsRevoked: 0 }),
        }),
      );
      expect(auditOf().row.action).toBe('auth.settings_updated');
      expect(auditOf().options).toEqual({ revokeStaffSessions: false });
      expect(auditOf().row.after).not.toHaveProperty('revokedStaffSessions');
    });

    it('merges over the effective settings, not the stored invalid value', async () => {
      // The stored accessTokenMinutes (999) is invalid, so the read path already resolved it
      // to the default 30. A PATCH of an unrelated field must not be refused for it.
      authSettings.resolveWithFallbacks.mockResolvedValue({
        settings: defaults,
        fallbacks: ['accessTokenMinutes'],
        updatedAt,
        storedFallbackValues: { accessTokenMinutes: 999 },
      });

      const result = await service.update(superAdmin, { emailVerificationGraceHours: 24 });

      expect(result).toEqual({
        ok: true,
        data: {
          settings: { ...defaults, emailVerificationGraceHours: 24 },
          propagatesWithinSeconds: 60,
          staffSessionsRevoked: 0,
        },
      });
      expect(auditOf().data).toEqual({ ...defaults, emailVerificationGraceHours: 24 });
      expect(auditOf().row.action).toBe('auth.settings_updated');
    });

    it('never writes the confirmation flag into the settings row', async () => {
      await service.update(superAdmin, {
        accessTokenMinutes: 45,
        confirmDisableStaffMfa: true,
      });

      expect(auditOf().data).not.toHaveProperty('confirmDisableStaffMfa');
    });

    it('refuses an explicit null with the rule message and writes nothing', async () => {
      // Defence in depth: the DTO refuses null before the service runs (see the controller
      // spec). If a caller ever bypasses the pipe, the shared rules still refuse it, and no
      // write happens.
      const result = await service.update(superAdmin, {
        accessTokenMinutes: null,
      } as unknown as UpdateAuthSettingsDto);

      expect(result).toEqual(
        expect.objectContaining({
          ok: false,
          status: HttpStatus.BAD_REQUEST,
          message: expect.stringMatching(
            /^accessTokenMinutes must be a whole number from 5 to 120\./,
          ) as unknown,
        }),
      );
      expect(repository.writeAudited).not.toHaveBeenCalled();
    });

    it('writes against the updatedAt the effective settings were read with', async () => {
      await service.update(superAdmin, { accessTokenMinutes: 45 });

      expect(auditOf().expected).toBe(updatedAt);
    });

    it('creates against a null updatedAt when there is no row yet', async () => {
      authSettings.resolveWithFallbacks.mockResolvedValue({
        settings: defaults,
        fallbacks: [],
        updatedAt: null,
        storedFallbackValues: {},
      });

      await service.update(superAdmin, { accessTokenMinutes: 45 });

      expect(auditOf().expected).toBeNull();
    });

    it('returns 409 and leaves the cache alone when the settings changed underneath', async () => {
      repository.writeAudited.mockResolvedValue({ kind: 'conflict' });

      await expect(service.update(superAdmin, { accessTokenMinutes: 45 })).resolves.toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'The auth settings changed while you were editing. Reload them and try again.',
      });
      expect(authSettings.invalidate).not.toHaveBeenCalled();
    });

    it('records which stored fields the write healed, and the raw values it overwrote', async () => {
      authSettings.resolveWithFallbacks.mockResolvedValue({
        settings: defaults,
        fallbacks: ['accessTokenMinutes', 'refreshReuseGraceSeconds'],
        updatedAt,
        storedFallbackValues: { accessTokenMinutes: 500, refreshReuseGraceSeconds: 999 },
      });

      await service.update(superAdmin, { emailVerificationGraceHours: 24 });

      const { row } = auditOf();
      expect(row.after).toEqual({
        ...defaults,
        emailVerificationGraceHours: 24,
        healedFallbacks: ['accessTokenMinutes', 'refreshReuseGraceSeconds'],
      });
      expect(row.before).toEqual({
        ...defaults,
        healedFrom: { accessTokenMinutes: 500, refreshReuseGraceSeconds: 999 },
      });
    });

    it('records no healedFallbacks or healedFrom key when nothing had fallen back', async () => {
      await service.update(superAdmin, { emailVerificationGraceHours: 24 });

      const { row } = auditOf();
      expect(row.after).toEqual({ ...defaults, emailVerificationGraceHours: 24 });
      expect(row.before).toEqual(defaults);
    });

    it('drops the cache only after the write succeeded', async () => {
      await service.update(superAdmin, { accessTokenMinutes: 45 });

      expect(authSettings.invalidate).toHaveBeenCalledTimes(1);
      expect(authSettings.invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(
        repository.writeAudited.mock.invocationCallOrder[0],
      );
    });

    it('returns 503 and leaves the cache alone when the write fails', async () => {
      repository.writeAudited.mockResolvedValue(null);

      await expect(service.update(superAdmin, { accessTokenMinutes: 45 })).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'The change could not be recorded in the audit trail and was not applied. Please try again.',
      });
      expect(authSettings.invalidate).not.toHaveBeenCalled();
    });

    it('returns 503 when the current settings could not be read', async () => {
      authSettings.resolveWithFallbacks.mockResolvedValue(null);

      await expect(service.update(superAdmin, { accessTokenMinutes: 45 })).resolves.toEqual(
        expect.objectContaining({ ok: false, status: HttpStatus.SERVICE_UNAVAILABLE }),
      );
      expect(repository.writeAudited).not.toHaveBeenCalled();
    });

    it('returns 500, logs, and leaves the cache alone when something throws', async () => {
      repository.writeAudited.mockRejectedValue(new Error('boom'));

      await expect(service.update(superAdmin, { accessTokenMinutes: 45 })).resolves.toEqual(
        expect.objectContaining({ ok: false, status: HttpStatus.INTERNAL_SERVER_ERROR }),
      );
      expect(authSettings.invalidate).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Exception occurred in AuthSettingsAdminService.update',
      );
    });
  });
});

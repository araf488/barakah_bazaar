import { PinoLogger } from 'nestjs-pino';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { AuthEventsService } from './auth-events.service';

const staff = () =>
  userFixture({ id: 'user-9', email: 'ops@barakahbazaar.com.bd', role: UserRole.OPS });

const customer = () => userFixture({ id: 'user-1', role: UserRole.CUSTOMER });

const context = () => ({
  sessionId: 'session-1',
  deviceId: 'device-1',
  userAgent: 'Chrome/140',
  ip: '203.0.113.42',
});

describe('AuthEventsService', () => {
  let auditLog: { append: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AuthEventsService;

  beforeEach(() => {
    auditLog = { append: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();
    service = new AuthEventsService(auditLog as unknown as AuditLogRepository, logger);
  });

  /** The single row the service handed the repository. */
  const written = (): Record<string, unknown> =>
    auditLog.append.mock.calls[0][0] as Record<string, unknown>;

  describe('what is recorded, and for whom', () => {
    it('writes a row for a staff login', async () => {
      await service.recordLogin(staff(), context());

      expect(auditLog.append).toHaveBeenCalledTimes(1);
      expect(written()).toMatchObject({
        action: 'auth.login',
        actorId: 'user-9',
        actorEmail: 'ops@barakahbazaar.com.bd',
        actorRole: UserRole.OPS,
        entityType: 'Session',
        entityId: 'session-1',
      });
    });

    it('writes nothing for a customer login', async () => {
      // Including customers buries the staff signal in noise and turns an operational log
      // into shopper surveillance.
      await service.recordLogin(customer(), context());

      expect(auditLog.append).not.toHaveBeenCalled();
    });

    it('records sessionId, deviceId, truncated ip and user agent', async () => {
      await service.recordLogin(staff(), context());

      expect(written().after).toEqual({
        sessionId: 'session-1',
        deviceId: 'device-1',
        userAgent: 'Chrome/140',
        ipAddress: '203.0.113.0',
      });
    });

    it('truncates an IPv6 address to a /64 as well', async () => {
      await service.recordLogin(staff(), { ...context(), ip: '2001:db8:85a3:1:2:3:4:5' });

      expect((written().after as { ipAddress: string }).ipAddress).toBe('2001:db8:85a3:1::');
    });

    it('never records a token, a password, a totp code or a recovery code', async () => {
      // The context type has no field for any of them, so this asserts the shape stays that
      // way: a caller cannot smuggle a credential in by adding a property.
      await service.recordLogin(staff(), {
        ...context(),
        // Deliberately extra, as a careless caller might pass it.
        password: 'hunter2',
        accessToken: 'eyJhbGciOi',
        totpCode: '123456',
        recoveryCode: 'abc123def456',
      } as unknown as ReturnType<typeof context>);

      const serialised = JSON.stringify(auditLog.append.mock.calls);

      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('eyJhbGciOi');
      expect(serialised).not.toContain('123456');
      expect(serialised).not.toContain('abc123def456');
    });
  });

  describe('each event', () => {
    it('records a failed staff login', async () => {
      await service.recordLoginFailed(staff(), context());

      expect(written()).toMatchObject({ action: 'auth.login_failed', actorId: 'user-9' });
    });

    it('records a failed second factor', async () => {
      await service.recordMfaFailed(staff(), context());

      expect(written()).toMatchObject({ action: 'auth.mfa_failed', actorId: 'user-9' });
    });

    it('records a staff member signing out', async () => {
      await service.recordLogout(staff(), 'session-1');

      expect(written()).toMatchObject({
        action: 'auth.logout',
        entityType: 'Session',
        entityId: 'session-1',
      });
    });

    it('records a session revoked for any other reason, with that reason', async () => {
      await service.recordSessionRevoked(staff(), 'session-1', 'device_mismatch');

      expect(written()).toMatchObject({
        action: 'auth.session_revoked',
        entityId: 'session-1',
        after: { reason: 'device_mismatch' },
      });
    });

    it('records a password change', async () => {
      await service.recordPasswordChanged(staff());

      expect(written()).toMatchObject({ action: 'auth.password_changed', entityId: 'user-9' });
    });

    it('records a device this account has not signed in from before', async () => {
      await service.recordNewDevice(staff(), context());

      expect(written()).toMatchObject({ action: 'auth.new_device', entityId: 'session-1' });
    });

    it('writes nothing for a customer on any event', async () => {
      await service.recordLoginFailed(customer(), context());
      await service.recordMfaFailed(customer(), context());
      await service.recordLogout(customer(), 'session-1');
      await service.recordSessionRevoked(customer(), 'session-1', 'device_mismatch');
      await service.recordPasswordChanged(customer());
      await service.recordNewDevice(customer(), context());

      expect(auditLog.append).not.toHaveBeenCalled();
    });
  });

  describe('failure is never the caller problem', () => {
    it('does not fail the caller when the audit write fails', async () => {
      auditLog.append.mockResolvedValue(false);

      await expect(service.recordLogin(staff(), context())).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('does not fail the caller when the audit write throws', async () => {
      // A successful sign-in must not become a 500 because the audit table is unreachable.
      auditLog.append.mockRejectedValue(new Error('audit table gone'));

      await expect(service.recordLogin(staff(), context())).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

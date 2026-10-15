import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { PasswordResetService } from '../auth/password-reset/password-reset.service';
import { AdminUserRepository } from './admin-user.repository';
import { AdminUserService } from './admin-user.service';
import { AdminUserQueryDto, CreateCustomerDto } from './dto/admin-user.dto';

const actor: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'boss@barakahbazaar.com.bd',
  role: UserRole.SUPER_ADMIN,
};

const listQuery = (): AdminUserQueryDto => new AdminUserQueryDto();

const target = (overrides = {}) =>
  userFixture({ id: 'user-2', role: UserRole.CUSTOMER, ...overrides });

describe('AdminUserService', () => {
  let repository: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let hasher: { hash: jest.Mock };
  let passwordReset: { request: jest.Mock };
  let users: { findByEmail: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AdminUserService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(target()),
      findPage: jest.fn().mockResolvedValue({ items: [userFixture()], total: 1 }),
      countActiveSuperAdmins: jest.fn().mockResolvedValue(2),
      updateAudited: jest.fn().mockResolvedValue(target()),
      createCustomerAudited: jest.fn(),
    };
    hasher = { hash: jest.fn().mockResolvedValue(SECRET_HASH) };
    passwordReset = { request: jest.fn().mockResolvedValue({ ok: true, data: undefined }) };
    users = { findByEmail: jest.fn().mockResolvedValue(undefined) };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new AdminUserService(
      repository as unknown as AdminUserRepository,
      authService as unknown as AuthService,
      hasher as unknown as PasswordHasher,
      passwordReset as unknown as PasswordResetService,
      users as unknown as AuthRepository,
      logger,
    );
  });

  const auditOf = (mock: jest.Mock): Record<string, unknown> => {
    const calls = mock.mock.calls as unknown[][];
    const build = calls[0][calls[0].length - 1] as (row: unknown) => Record<string, unknown>;
    return build(target());
  };

  const SECRET_HASH = 'scrypt$secret-hash';
  const SECRET_TOTP = 'enc.secret.value';
  const ALLOWLISTED_KEYS = [
    'createdAt',
    'email',
    'fullName',
    'id',
    'isActive',
    'lastSeenAt',
    'phone',
    'role',
  ];
  const withSecrets = () => target({ passwordHash: SECRET_HASH, totpSecretEncrypted: SECRET_TOTP });

  const expectNoCredentialsInAudit = (mock: jest.Mock) => {
    const calls = mock.mock.calls as unknown[][];
    const build = calls[0][calls[0].length - 1] as (row: unknown) => Record<string, unknown>;
    const audit = build(withSecrets());
    const serialised = JSON.stringify(audit);

    expect(serialised).not.toContain(SECRET_HASH);
    expect(serialised).not.toContain(SECRET_TOTP);
    expect(Object.keys(audit.before as object).sort((a, b) => a.localeCompare(b))).toEqual(
      ALLOWLISTED_KEYS,
    );
    expect(Object.keys(audit.after as object).sort((a, b) => a.localeCompare(b))).toEqual(
      ALLOWLISTED_KEYS,
    );
  };

  describe('listUsers', () => {
    it('returns the mapped page including staff-only fields', async () => {
      const result = await service.listUsers(listQuery());

      expect(result.ok && result.data.items[0]).toEqual(
        expect.objectContaining({ isActive: true, lastSeenAt: expect.any(Date) }),
      );
    });

    it('answers 503 when the read failed', async () => {
      repository.findPage.mockResolvedValue(null);

      const result = await service.listUsers(listQuery());

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('setAccountEnabled', () => {
    it('disables an account and audits it', async () => {
      const result = await service.setAccountEnabled(actor, 'user-2', false);

      expect(result.ok).toBe(true);
      expect(repository.updateAudited.mock.calls[0][1]).toEqual({ isActive: false });
      expect(auditOf(repository.updateAudited).action).toBe('customer.disabled');
    });

    it('keeps credentials out of the audit trail', async () => {
      repository.findById.mockResolvedValue(withSecrets());

      await service.setAccountEnabled(actor, 'user-2', false);

      expectNoCredentialsInAudit(repository.updateAudited);
    });

    it('re-enables and records the opposite action', async () => {
      await service.setAccountEnabled(actor, 'user-2', true);

      expect(auditOf(repository.updateAudited).action).toBe('customer.enabled');
    });

    it('refuses to act on your own account', async () => {
      // One mistaken click would otherwise lock the operator out of their own system.
      const result = await service.setAccountEnabled(actor, 'user-1', false);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message:
          'You cannot change your own account here. Ask another super admin to make this change.',
      });
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('refuses to disable the last enabled super admin', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));
      repository.countActiveSuperAdmins.mockResolvedValue(1);

      const result = await service.setAccountEnabled(actor, 'user-2', false);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'This is the only super admin. Promote someone else before changing this account.',
      });
    });

    it('allows disabling a super admin while others remain', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));
      repository.countActiveSuperAdmins.mockResolvedValue(3);

      await expect(service.setAccountEnabled(actor, 'user-2', false)).resolves.toEqual(
        expect.objectContaining({ ok: true }),
      );
    });

    it('does not run the lockout check when enabling', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));

      await service.setAccountEnabled(actor, 'user-2', true);

      expect(repository.countActiveSuperAdmins).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown account', async () => {
      repository.findById.mockResolvedValue(undefined);

      const result = await service.setAccountEnabled(actor, 'user-9', false);

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('changeRole', () => {
    it('writes the role to the column, the only place a role now lives', async () => {
      await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(repository.updateAudited.mock.calls[0][1]).toEqual({ role: UserRole.OPS });
      expect(auditOf(repository.updateAudited).action).toBe('staff.role_changed');
    });

    it('keeps credentials out of the audit trail', async () => {
      repository.findById.mockResolvedValue(withSecrets());

      await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expectNoCredentialsInAudit(repository.updateAudited);
    });

    it('changes nothing when the write and its audit row roll back', async () => {
      // Row and audit entry share one transaction, so there is no half-applied role to
      // reconcile: the failure is total and the caller can simply retry.
      repository.updateAudited.mockResolvedValue(null);

      const result = await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'The change could not be recorded in the audit trail and was not applied. Please try again.',
      });
    });

    it('is a no-op when the role already matches', async () => {
      const result = await service.changeRole(actor, 'user-2', { role: UserRole.CUSTOMER });

      expect(result.ok).toBe(true);
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('refuses to change your own role', async () => {
      const result = await service.changeRole(actor, 'user-1', { role: UserRole.OPS });

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('refuses to demote the last super admin', async () => {
      repository.findById.mockResolvedValue(target({ role: UserRole.SUPER_ADMIN }));
      repository.countActiveSuperAdmins.mockResolvedValue(1);

      const result = await service.changeRole(actor, 'user-2', { role: UserRole.OPS });

      expect(!result.ok && result.status).toBe(HttpStatus.CONFLICT);
      expect(repository.updateAudited).not.toHaveBeenCalled();
    });

    it('allows promoting someone to super admin without a lockout check', async () => {
      const result = await service.changeRole(actor, 'user-2', { role: UserRole.SUPER_ADMIN });

      expect(result.ok).toBe(true);
      expect(repository.countActiveSuperAdmins).not.toHaveBeenCalled();
    });
  });

  describe('createCustomer', () => {
    const dto = (overrides: Partial<CreateCustomerDto> = {}): CreateCustomerDto =>
      Object.assign(new CreateCustomerDto(), {
        email: '  Aisha@Example.COM ',
        fullName: '  Aisha Rahman ',
        ...overrides,
      });
    const created = () =>
      userFixture({
        id: 'user-9',
        email: 'aisha@example.com',
        fullName: 'Aisha Rahman',
        role: UserRole.CUSTOMER,
        passwordHash: SECRET_HASH,
      });

    beforeEach(() => {
      repository.createCustomerAudited.mockResolvedValue({ kind: 'created', user: created() });
    });

    it('answers only the allowlisted user and the queued flag, with no credential', async () => {
      const result = await service.createCustomer(actor, dto());

      expect(result).toStrictEqual({
        ok: true,
        data: {
          user: {
            id: 'user-9',
            email: 'aisha@example.com',
            phone: created().phone,
            fullName: 'Aisha Rahman',
            role: 'CUSTOMER',
            isActive: true,
            lastSeenAt: created().lastSeenAt,
            createdAt: created().createdAt,
          },
          passwordSetupEmailQueued: true,
        },
      });
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain(SECRET_HASH);
      expect(serialised).not.toMatch(/[A-Za-z0-9_-]{43}/);
    });

    it('stores the email lowercased and trimmed, the name trimmed and the language BN by default', async () => {
      await service.createCustomer(actor, dto());

      expect(repository.createCustomerAudited.mock.calls[0][0]).toEqual({
        email: 'aisha@example.com',
        fullName: 'Aisha Rahman',
        preferredLanguage: 'BN',
        passwordHash: SECRET_HASH,
      });
    });

    it('keeps an explicit language', async () => {
      await service.createCustomer(actor, dto({ preferredLanguage: 'EN' }));

      expect(repository.createCustomerAudited.mock.calls[0][0].preferredLanguage).toBe('EN');
    });

    it('hashes a random 43-character value that differs on every call', async () => {
      await service.createCustomer(actor, dto());
      await service.createCustomer(actor, dto());

      const [first, second] = hasher.hash.mock.calls.map((call: string[]) => call[0]);
      expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(second).not.toBe(first);
    });

    it('never puts the plaintext password in any log level or the result', async () => {
      const result = await service.createCustomer(actor, dto());

      const plaintext = hasher.hash.mock.calls[0][0] as string;
      const logged = [
        logger.error,
        logger.warn,
        logger.info,
        logger.debug,
        logger.trace,
        logger.fatal,
      ].map((method) => method.mock.calls);
      expect(JSON.stringify([result, logged])).not.toContain(plaintext);
    });

    it('requests the reset with the normalized email, after the create', async () => {
      await service.createCustomer(actor, dto());

      expect(passwordReset.request).toHaveBeenCalledWith('aisha@example.com');
      expect(repository.createCustomerAudited.mock.invocationCallOrder[0]).toBeLessThan(
        passwordReset.request.mock.invocationCallOrder[0],
      );
    });

    it('audits the creation with the allowlisted after-state and no before or hash', async () => {
      await service.createCustomer(actor, dto());

      const build = repository.createCustomerAudited.mock.calls[0][1] as (
        row: unknown,
      ) => Record<string, unknown>;
      const audit = build(created());

      expect(audit).toMatchObject({
        actorId: 'user-1',
        action: 'customer.created_by_staff',
        entityType: 'User',
        entityId: 'user-9',
        before: undefined,
      });
      expect(JSON.stringify(audit)).not.toContain(SECRET_HASH);
      expect(Object.keys(audit.after as object).sort((a, b) => a.localeCompare(b))).toEqual(
        ALLOWLISTED_KEYS,
      );
    });

    it('answers 409 when the email already has an account and sends no reset', async () => {
      repository.createCustomerAudited.mockResolvedValue({ kind: 'exists' });

      await expect(service.createCustomer(actor, dto())).resolves.toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'An account already exists for that email address.',
      });
      expect(passwordReset.request).not.toHaveBeenCalled();
    });

    it('answers 503 AuditTrailUnavailable when the write failed and sends no reset', async () => {
      repository.createCustomerAudited.mockResolvedValue(null);

      await expect(service.createCustomer(actor, dto())).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'The change could not be recorded in the audit trail and was not applied. Please try again.',
      });
      expect(passwordReset.request).not.toHaveBeenCalled();
    });

    it('answers 409 for an existing mixed-case address before hashing or creating anything', async () => {
      users.findByEmail.mockResolvedValue(userFixture({ email: 'Aisha@Example.com' }));

      await expect(service.createCustomer(actor, dto())).resolves.toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'An account already exists for that email address.',
      });
      expect(users.findByEmail).toHaveBeenCalledWith('aisha@example.com');
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(repository.createCustomerAudited).not.toHaveBeenCalled();
      expect(passwordReset.request).not.toHaveBeenCalled();
    });

    it('answers 503 when the existence lookup faults, without hashing or creating', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(service.createCustomer(actor, dto())).resolves.toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(repository.createCustomerAudited).not.toHaveBeenCalled();
    });

    it('still answers ok when the reset request rejects, and logs a warning without the email', async () => {
      passwordReset.request.mockRejectedValue(new Error('smtp down'));

      const result = await service.createCustomer(actor, dto());

      expect(result).toMatchObject({ ok: true, data: { passwordSetupEmailQueued: true } });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('aisha@example.com');
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('still answers ok when the reset request resolves a failure', async () => {
      passwordReset.request.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'no',
      });

      await expect(service.createCustomer(actor, dto())).resolves.toMatchObject({
        ok: true,
        data: { passwordSetupEmailQueued: true },
      });
    });

    it('passes through a failed actor resolution without creating anything', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: 'no',
      });

      await expect(service.createCustomer(actor, dto())).resolves.toMatchObject({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
      });
      expect(repository.createCustomerAudited).not.toHaveBeenCalled();
    });

    it('answers 500 and logs when something throws', async () => {
      hasher.hash.mockRejectedValue(new Error('boom'));

      await expect(service.createCustomer(actor, dto())).resolves.toMatchObject({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});

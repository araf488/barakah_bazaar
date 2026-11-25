import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { Language, User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthRepository } from './auth.repository';
import { PasswordHasher } from './crypto/password-hasher';
import { PasswordPolicy } from './passwords/password-policy';
import { RegistrationService } from './registration.service';
import { EmailVerificationService } from './verification/email-verification.service';

const dto = {
  email: 'shopper@example.com',
  password: 'Correct Horse Battery 41!',
  fullName: 'Aisha Rahman',
};

const userRow = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'shopper@example.com',
    fullName: 'Aisha Rahman',
    role: UserRole.CUSTOMER,
    preferredLanguage: Language.BN,
    isActive: true,
    emailVerifiedAt: null,
    ...overrides,
  }) as User;

describe('RegistrationService', () => {
  let repository: { findByEmail: jest.Mock; createCustomer: jest.Mock };
  let hasher: { hash: jest.Mock; verify: jest.Mock };
  let policy: { check: jest.Mock };
  let verification: { issueFor: jest.Mock };
  let email: { send: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: RegistrationService;

  beforeEach(() => {
    repository = {
      findByEmail: jest.fn().mockResolvedValue(undefined),
      createCustomer: jest.fn().mockResolvedValue(userRow()),
    };
    hasher = {
      hash: jest.fn().mockResolvedValue('scrypt$hash'),
      verify: jest.fn().mockResolvedValue(false),
    };
    policy = { check: jest.fn().mockReturnValue(null) };
    verification = { issueFor: jest.fn().mockResolvedValue(undefined) };
    email = { send: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();

    service = new RegistrationService(
      repository as unknown as AuthRepository,
      hasher as unknown as PasswordHasher,
      policy as unknown as PasswordPolicy,
      verification as unknown as EmailVerificationService,
      email,
      logger,
    );
  });

  it('creates the account and issues a verification for a new address', async () => {
    const result = await service.register(dto);

    expect(result.ok).toBe(true);
    expect(repository.createCustomer).toHaveBeenCalled();
    expect(verification.issueFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
  });

  it('defaults preferredLanguage to BN when the caller omits it', async () => {
    await service.register(dto);

    expect(repository.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ preferredLanguage: Language.BN }),
    );
  });

  it('passes an explicit preferredLanguage through rather than defaulting it', async () => {
    await service.register({ ...dto, preferredLanguage: Language.EN });

    expect(repository.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ preferredLanguage: Language.EN }),
    );
  });

  it('rejects a password the policy refuses, with the policy message verbatim', async () => {
    policy.check.mockReturnValue('Your password must be at least 12 characters.');

    const result = await service.register(dto);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.BAD_REQUEST,
      message: 'Your password must be at least 12 characters.',
    });
    expect(repository.createCustomer).not.toHaveBeenCalled();
  });

  it('checks the password before looking the address up, so a weak one costs no read', async () => {
    policy.check.mockReturnValue('Your password must be at least 12 characters.');

    await service.register(dto);

    expect(repository.findByEmail).not.toHaveBeenCalled();
  });

  describe('an address that already has an account', () => {
    beforeEach(() => repository.findByEmail.mockResolvedValue(userRow()));

    it('answers exactly as a new registration does', async () => {
      const existing = await service.register(dto);

      repository.findByEmail.mockResolvedValue(undefined);
      const fresh = await service.register(dto);

      expect(existing).toEqual(fresh);
    });

    it('creates nothing', async () => {
      await service.register(dto);

      expect(repository.createCustomer).not.toHaveBeenCalled();
      expect(verification.issueFor).not.toHaveBeenCalled();
    });

    // The load-bearing one. Without this the response bodies match and the clock gives the
    // answer away: creating an account runs scrypt (~100ms), this path would not.
    it('still runs a hash, so the two paths cost the same time', async () => {
      await service.register(dto);

      expect(hasher.verify).toHaveBeenCalledWith(dto.password, PasswordHasher.DUMMY_HASH);
    });

    it('sends the already-registered email, which carries no credential', async () => {
      await service.register(dto);

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'shopper@example.com' }),
      );
      const sent = email.send.mock.calls[0][0];
      expect(`${sent.body}${sent.html ?? ''}`).not.toMatch(/\b\d{6}\b/);
    });
  });

  it('answers 503 when the address lookup fails, rather than creating a duplicate', async () => {
    repository.findByEmail.mockResolvedValue(null);

    const result = await service.register(dto);

    expect(result).toMatchObject({ ok: false, status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(repository.createCustomer).not.toHaveBeenCalled();
  });

  it('answers 503 when the account cannot be written', async () => {
    repository.createCustomer.mockResolvedValue(null);

    const result = await service.register(dto);

    expect(result).toMatchObject({ ok: false, status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(verification.issueFor).not.toHaveBeenCalled();
  });

  it('never logs the password', async () => {
    repository.findByEmail.mockRejectedValue(new Error('boom'));

    await service.register(dto);

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(dto.password);
  });
});

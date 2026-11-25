import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { User, UserRole } from '../../../infra/prisma/prisma-client';
import { AuthRepository } from '../auth.repository';
import { PasswordHasher } from '../crypto/password-hasher';
import { PasswordChangeService } from './password-change.service';
import { PasswordUpdater } from './password-updater';

const CURRENT = 'correct horse battery staple';
const NEW_PASSWORD = 'Marbled Kingfisher 41!';
const INVALID_CREDENTIALS = 'Those sign-in details are not correct.';

const makeUser = (overrides: Record<string, unknown> = {}): User =>
  ({
    id: 'user-1',
    email: 'shopper@example.com',
    fullName: 'Aisha Rahman',
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
    passwordHash: 'scrypt$hash',
    role: UserRole.CUSTOMER,
    ...overrides,
  }) as unknown as User;

describe('PasswordChangeService', () => {
  let users: { findById: jest.Mock };
  let hasher: { verify: jest.Mock };
  let updater: { replace: jest.Mock; announce: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: PasswordChangeService;

  beforeEach(() => {
    users = { findById: jest.fn().mockResolvedValue(makeUser()) };
    hasher = { verify: jest.fn().mockResolvedValue(true) };
    updater = {
      replace: jest.fn().mockResolvedValue({ ok: true, data: undefined }),
      announce: jest.fn().mockResolvedValue(undefined),
    };
    logger = createMockLogger();

    service = new PasswordChangeService(
      users as unknown as AuthRepository,
      hasher as unknown as PasswordHasher,
      updater as unknown as PasswordUpdater,
      logger,
    );
  });

  it('verifies the current password, replaces it keeping the calling session, and announces', async () => {
    const result = await service.change('user-1', 'session-1', CURRENT, NEW_PASSWORD);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(hasher.verify).toHaveBeenCalledWith(CURRENT, 'scrypt$hash');
    expect(updater.replace).toHaveBeenCalledWith(makeUser(), NEW_PASSWORD, 'session-1');
    expect(updater.announce).toHaveBeenCalledWith(makeUser());
  });

  it('never hands the current password to the policy — only the new one is judged', async () => {
    await service.change('user-1', 'session-1', CURRENT, NEW_PASSWORD);

    expect(JSON.stringify(updater.replace.mock.calls)).not.toContain(CURRENT);
  });

  it('answers 401 with the sign-in message for a wrong current password, and changes nothing', async () => {
    hasher.verify.mockResolvedValue(false);

    const result = await service.change('user-1', 'session-1', 'wrong password!', NEW_PASSWORD);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.UNAUTHORIZED,
      message: INVALID_CREDENTIALS,
    });
    expect(updater.replace).not.toHaveBeenCalled();
    expect(updater.announce).not.toHaveBeenCalled();
  });

  it('answers 401 for an account with no password, without running the hasher', async () => {
    users.findById.mockResolvedValue(makeUser({ passwordHash: null }));

    const result = await service.change('user-1', 'session-1', CURRENT, NEW_PASSWORD);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.UNAUTHORIZED,
      message: INVALID_CREDENTIALS,
    });
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it('answers 401 when the account disappeared since the guard ran', async () => {
    users.findById.mockResolvedValue(undefined);

    expect(await service.change('user-1', 'session-1', CURRENT, NEW_PASSWORD)).toEqual({
      ok: false,
      status: HttpStatus.UNAUTHORIZED,
      message: INVALID_CREDENTIALS,
    });
  });

  it('answers 503 when the account cannot be read', async () => {
    users.findById.mockResolvedValue(null);

    expect(await service.change('user-1', 'session-1', CURRENT, NEW_PASSWORD)).toEqual({
      ok: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The service is temporarily unavailable. Please try again shortly.',
    });
  });

  it('passes a policy refusal through verbatim and announces nothing', async () => {
    updater.replace.mockResolvedValue({
      ok: false,
      status: HttpStatus.BAD_REQUEST,
      message: 'Your password must be at least 12 characters.',
    });

    const result = await service.change('user-1', 'session-1', CURRENT, 'short');

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.BAD_REQUEST,
      message: 'Your password must be at least 12 characters.',
    });
    expect(updater.announce).not.toHaveBeenCalled();
  });

  it('answers 500, logged, and never logs either password, when something throws', async () => {
    hasher.verify.mockRejectedValue(new Error('boom'));

    const result = await service.change('user-1', 'session-1', CURRENT, NEW_PASSWORD);

    expect(result).toEqual({
      ok: false,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Something went wrong on our end. Please try again.',
    });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain(CURRENT);
    expect(logged).not.toContain(NEW_PASSWORD);
  });
});

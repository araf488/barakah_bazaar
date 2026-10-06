import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { User, UserRole } from '../../../infra/prisma/prisma-client';
import { AuthEventsService } from '../auth-events.service';
import { AuthRepository } from '../auth.repository';
import { PasswordHasher } from '../crypto/password-hasher';
import { SessionService } from '../sessions/session.service';
import { PasswordPolicy } from './password-policy';
import { PasswordUpdater } from './password-updater';

const NEW_PASSWORD = 'Marbled Kingfisher 41!';

const makeUser = (overrides: Record<string, unknown> = {}): User =>
  ({
    id: 'user-1',
    email: 'shopper@example.com',
    fullName: 'Aisha Rahman',
    role: UserRole.CUSTOMER,
    emailVerifiedAt: null,
    ...overrides,
  }) as unknown as User;

describe('PasswordUpdater', () => {
  let users: { updatePasswordHash: jest.Mock };
  let sessions: { revokeAll: jest.Mock; revokeAllExcept: jest.Mock };
  let hasher: { hash: jest.Mock };
  let policy: { check: jest.Mock };
  let events: { recordPasswordChanged: jest.Mock };
  let email: { send: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let updater: PasswordUpdater;

  beforeEach(() => {
    users = { updatePasswordHash: jest.fn().mockResolvedValue(makeUser()) };
    sessions = {
      revokeAll: jest.fn().mockResolvedValue({ ok: true, data: 2 }),
      revokeAllExcept: jest.fn().mockResolvedValue({ ok: true, data: 1 }),
    };
    hasher = { hash: jest.fn().mockResolvedValue('scrypt$new-hash') };
    policy = { check: jest.fn().mockReturnValue(null) };
    events = { recordPasswordChanged: jest.fn().mockResolvedValue(undefined) };
    email = { send: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();

    updater = new PasswordUpdater(
      users as unknown as AuthRepository,
      sessions as unknown as SessionService,
      hasher as unknown as PasswordHasher,
      policy as unknown as PasswordPolicy,
      events as unknown as AuthEventsService,
      email,
      logger,
    );
  });

  describe('replace', () => {
    it('checks the new password against the account email and full name', async () => {
      await updater.replace(makeUser(), NEW_PASSWORD);

      expect(policy.check).toHaveBeenCalledWith(NEW_PASSWORD, {
        email: 'shopper@example.com',
        fullName: 'Aisha Rahman',
      });
    });

    it('returns the policy message verbatim and changes nothing when the password is weak', async () => {
      policy.check.mockReturnValue('Your password must be at least 12 characters.');

      const result = await updater.replace(makeUser(), 'short');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Your password must be at least 12 characters.',
      });
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
      expect(sessions.revokeAllExcept).not.toHaveBeenCalled();
      expect(users.updatePasswordHash).not.toHaveBeenCalled();
    });

    it('revokes every session, then writes the new hash — in that order', async () => {
      const result = await updater.replace(makeUser(), NEW_PASSWORD);

      expect(result).toEqual({ ok: true, data: undefined });
      expect(sessions.revokeAll).toHaveBeenCalledWith('user-1');
      expect(users.updatePasswordHash).toHaveBeenCalledWith('user-1', 'scrypt$new-hash');
      expect(sessions.revokeAll.mock.invocationCallOrder[0]).toBeLessThan(
        users.updatePasswordHash.mock.invocationCallOrder[0],
      );
    });

    it('hashes before revoking, so the signed-out-but-unchanged window is one write long', async () => {
      await updater.replace(makeUser(), NEW_PASSWORD);

      expect(hasher.hash).toHaveBeenCalledWith(NEW_PASSWORD);
      expect(hasher.hash.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.revokeAll.mock.invocationCallOrder[0],
      );
    });

    it('keeps the named session and revokes the rest when given one', async () => {
      await updater.replace(makeUser(), NEW_PASSWORD, 'session-keep');

      expect(sessions.revokeAllExcept).toHaveBeenCalledWith('user-1', 'session-keep');
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('revokes the other sessions, then writes the new hash — in that order — when keeping one', async () => {
      const result = await updater.replace(makeUser(), NEW_PASSWORD, 'session-keep');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(users.updatePasswordHash).toHaveBeenCalledWith('user-1', 'scrypt$new-hash');
      expect(sessions.revokeAllExcept.mock.invocationCallOrder[0]).toBeLessThan(
        users.updatePasswordHash.mock.invocationCallOrder[0],
      );
    });

    it('refuses with 503 and writes nothing when revoking the other sessions fails', async () => {
      sessions.revokeAllExcept.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      const result = await updater.replace(makeUser(), NEW_PASSWORD, 'session-keep');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(users.updatePasswordHash).not.toHaveBeenCalled();
    });

    it('refuses with 503 and writes nothing when revocation fails', async () => {
      sessions.revokeAll.mockResolvedValue({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });

      const result = await updater.replace(makeUser(), NEW_PASSWORD);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(users.updatePasswordHash).not.toHaveBeenCalled();
    });

    it('revokes every session again after the write: revoke, write, revoke', async () => {
      await updater.replace(makeUser(), NEW_PASSWORD);

      expect(sessions.revokeAll).toHaveBeenCalledTimes(2);
      expect(sessions.revokeAll).toHaveBeenNthCalledWith(2, 'user-1');
      const [firstRevoke, secondRevoke] = sessions.revokeAll.mock.invocationCallOrder;
      const write = users.updatePasswordHash.mock.invocationCallOrder[0];
      expect(firstRevoke).toBeLessThan(write);
      expect(write).toBeLessThan(secondRevoke);
    });

    it('revokes the other sessions again after the write, still keeping the named one', async () => {
      await updater.replace(makeUser(), NEW_PASSWORD, 'session-keep');

      expect(sessions.revokeAllExcept).toHaveBeenCalledTimes(2);
      expect(sessions.revokeAllExcept).toHaveBeenNthCalledWith(2, 'user-1', 'session-keep');
      expect(sessions.revokeAll).not.toHaveBeenCalled();
      const [firstRevoke, secondRevoke] = sessions.revokeAllExcept.mock.invocationCallOrder;
      const write = users.updatePasswordHash.mock.invocationCallOrder[0];
      expect(firstRevoke).toBeLessThan(write);
      expect(write).toBeLessThan(secondRevoke);
    });

    it('still answers ok, logged with the account id, when the second revoke fails', async () => {
      sessions.revokeAll.mockResolvedValueOnce({ ok: true, data: 2 }).mockResolvedValueOnce({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      const result = await updater.replace(makeUser(), NEW_PASSWORD);

      expect(result).toEqual({ ok: true, data: undefined });
      expect(users.updatePasswordHash).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        { userId: 'user-1' },
        'Could not repeat session revocation after a password write; password is changed',
      );
    });

    it('does not revoke a second time when the write fails', async () => {
      users.updatePasswordHash.mockResolvedValue(null);

      await updater.replace(makeUser(), NEW_PASSWORD);

      expect(sessions.revokeAll).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when the password write itself fails', async () => {
      users.updatePasswordHash.mockResolvedValue(null);

      const result = await updater.replace(makeUser(), NEW_PASSWORD);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 500 and never logs the password when something throws', async () => {
      hasher.hash.mockRejectedValue(new Error('boom'));

      const result = await updater.replace(makeUser(), NEW_PASSWORD);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });
      expect(logger.error).toHaveBeenCalled();
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(NEW_PASSWORD);
    });
  });

  describe('announce', () => {
    it('records auth.password_changed for the account and mails the changed notice', async () => {
      const user = makeUser({ role: UserRole.OPS });

      await updater.announce(user);

      expect(events.recordPasswordChanged).toHaveBeenCalledWith(user);
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(email.send.mock.calls[0][0].to).toBe('shopper@example.com');
      expect(email.send.mock.calls[0][0].subject).toBe('Your Barakah Bazaar password was changed');
    });

    it('never throws, because the password is already changed by the time it runs', async () => {
      email.send.mockRejectedValue(new Error('smtp down'));

      await expect(updater.announce(makeUser())).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

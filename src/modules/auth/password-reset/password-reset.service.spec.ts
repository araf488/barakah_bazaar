import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { User, UserRole } from '../../../infra/prisma/prisma-client';
import { AuthRepository } from '../auth.repository';
import { PasswordUpdater } from '../passwords/password-updater';
import { PasswordResetRepository, PasswordResetWithUser } from './password-reset.repository';
import { PasswordResetService } from './password-reset.service';

const NOW = new Date('2026-10-05T00:00:00.000Z');
const CLAIMED_AT = new Date('2026-10-05T00:00:00.500Z');
const OK = { ok: true, data: undefined };

/** setImmediate turns per flush; each one drains every microtask queued before it. */
const BACKGROUND_FLUSH_TURNS = 3;

const NEW_PASSWORD = 'Marbled Kingfisher 41!';
const RESET_INVALID = 'That password reset link or code is not valid. Please request a new one.';
const TOO_MANY = 'Too many incorrect codes. Please request a new password reset email.';
const UNAVAILABLE = 'The service is temporarily unavailable. Please try again shortly.';

/** Hashed here rather than through the production helper, so the test states the algorithm. */
const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('base64url');

const makeUser = (overrides: Record<string, unknown> = {}): User =>
  ({
    id: 'user-1',
    email: 'shopper@example.com',
    fullName: 'Aisha Rahman',
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
    passwordHash: 'scrypt$hash',
    role: UserRole.CUSTOMER,
    isActive: true,
    emailVerifiedAt: null,
    ...overrides,
  }) as unknown as User;

const resetRow = (overrides: Partial<PasswordResetWithUser> = {}): PasswordResetWithUser => ({
  id: 'pr-1',
  userId: 'user-1',
  email: 'shopper@example.com',
  tokenHash: sha256('raw-token'),
  codeHash: sha256('481920'),
  expiresAt: new Date(NOW.getTime() + 60 * 60_000),
  attempts: 0,
  consumedAt: null,
  createdAt: new Date(NOW.getTime() - 5 * 60_000),
  user: makeUser(),
  ...overrides,
});

/**
 * Lets the detached `issueInBackground` chain run to the end. Every collaborator in it is a mock
 * that settles at once, so a few event-loop turns finish it. setImmediate is left real by the
 * fake-timer setup below for exactly this.
 */
const flushBackground = async (): Promise<void> => {
  for (let turn = 0; turn < BACKGROUND_FLUSH_TURNS; turn += 1) {
    await new Promise(setImmediate);
  }
};

/** Pulls the raw link and code back out of the plain-text body the reset email carries. */
const extractCredentials = (body: string): { link: string; token: string; code: string } => {
  const link = /Open this link:\n(.+)/.exec(body)?.[1] ?? '';
  const code = /Or enter this code in the app:\n(\d+)/.exec(body)?.[1] ?? '';
  return { link, token: link.split('token=')[1] ?? '', code };
};

describe('PasswordResetService', () => {
  let repository: Record<
    | 'create'
    | 'findByTokenHash'
    | 'findNewestLiveForEmail'
    | 'incrementAttempts'
    | 'claim'
    | 'release'
    | 'consumeAllForUser',
    jest.Mock
  >;
  let users: { findByEmail: jest.Mock; updateEmailVerifiedAt: jest.Mock };
  let updater: { replace: jest.Mock; announce: jest.Mock };
  let email: { send: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: PasswordResetService;

  const config = createMockConfig({
    PASSWORD_RESET_TTL_MINUTES: 60,
    APP_PUBLIC_BASE_URL: 'http://localhost:3000',
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] }).setSystemTime(NOW);

    repository = {
      create: jest.fn().mockResolvedValue(resetRow()),
      findByTokenHash: jest.fn(),
      findNewestLiveForEmail: jest.fn().mockResolvedValue(undefined),
      incrementAttempts: jest.fn().mockResolvedValue(1),
      claim: jest.fn().mockResolvedValue(CLAIMED_AT),
      release: jest.fn().mockResolvedValue(1),
      consumeAllForUser: jest.fn().mockResolvedValue(1),
    };
    users = {
      findByEmail: jest.fn().mockResolvedValue(makeUser()),
      updateEmailVerifiedAt: jest.fn().mockResolvedValue(makeUser({ emailVerifiedAt: NOW })),
    };
    updater = {
      replace: jest.fn().mockResolvedValue({ ok: true, data: undefined }),
      announce: jest.fn().mockResolvedValue(undefined),
    };
    email = { send: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();

    service = new PasswordResetService(
      repository as unknown as PasswordResetRepository,
      users as unknown as AuthRepository,
      updater as unknown as PasswordUpdater,
      email,
      config,
      logger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('request', () => {
    it('answers after the account lookup alone, while the mail is still in flight', async () => {
      email.send.mockReturnValue(new Promise(() => undefined));

      await expect(service.request('shopper@example.com')).resolves.toEqual(OK);
      await flushBackground();
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('answers while the cooldown read has not come back, so no database write is on the clock', async () => {
      repository.findNewestLiveForEmail.mockReturnValue(new Promise(() => undefined));

      await expect(service.request('shopper@example.com')).resolves.toEqual(OK);
      await flushBackground();
      expect(repository.consumeAllForUser).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('mints a token and code, stores only their hashes, and mails both with a config-built link', async () => {
      const result = await service.request('shopper@example.com');
      await flushBackground();

      expect(result).toEqual({ ok: true, data: undefined });
      const stored = repository.create.mock.calls[0][0];
      const sent = email.send.mock.calls[0][0];
      const { link, token, code } = extractCredentials(sent.body as string);

      expect(link).toBe(`http://localhost:3000/reset-password?token=${token}`);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(code).toMatch(/^\d{6}$/);
      expect(stored.tokenHash).toBe(sha256(token));
      expect(stored.codeHash).toBe(sha256(code));
      expect(stored.tokenHash).not.toBe(token);
      expect(stored.codeHash).not.toBe(code);
    });

    it('expires the credential one hour out, not twenty-four', async () => {
      await service.request('shopper@example.com');
      await flushBackground();

      expect(repository.create.mock.calls[0][0].expiresAt).toEqual(
        new Date('2026-10-05T01:00:00.000Z'),
      );
      expect(email.send.mock.calls[0][0].body).toContain('60 minutes');
    });

    it('closes every earlier live record before issuing, so only the newest email works', async () => {
      await service.request('shopper@example.com');
      await flushBackground();

      expect(repository.consumeAllForUser).toHaveBeenCalledWith('user-1');
      expect(repository.consumeAllForUser.mock.invocationCallOrder[0]).toBeLessThan(
        repository.create.mock.invocationCallOrder[0],
      );
    });

    it('looks up the cooldown and mails by the stored address, whatever case was submitted', async () => {
      await service.request('Shopper@Example.COM');
      await flushBackground();

      expect(users.findByEmail).toHaveBeenCalledWith('Shopper@Example.COM');
      expect(repository.findNewestLiveForEmail).toHaveBeenCalledWith('shopper@example.com');
      expect(email.send.mock.calls[0][0].to).toBe('shopper@example.com');
    });

    it('answers ok and sends nothing for an address with no account', async () => {
      users.findByEmail.mockResolvedValue(undefined);

      expect(await service.request('nobody@example.com')).toEqual(OK);
      await flushBackground();

      expect(repository.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('answers ok and sends nothing for a disabled account', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ isActive: false }));

      expect(await service.request('shopper@example.com')).toEqual(OK);
      await flushBackground();

      expect(email.send).not.toHaveBeenCalled();
    });

    it('answers ok and sends nothing for an account with no password yet — a pending invitation', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ passwordHash: null }));

      expect(await service.request('shopper@example.com')).toEqual(OK);
      await flushBackground();

      expect(repository.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('answers ok and sends nothing inside the 60-second cooldown', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(
        resetRow({ createdAt: new Date(NOW.getTime() - 59_000) }),
      );

      expect(await service.request('shopper@example.com')).toEqual(OK);
      await flushBackground();

      expect(repository.consumeAllForUser).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('issues again once the cooldown has passed', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(
        resetRow({ createdAt: new Date(NOW.getTime() - 61_000) }),
      );

      await service.request('shopper@example.com');
      await flushBackground();

      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('answers ok without issuing when the account lookup faults', async () => {
      users.findByEmail.mockResolvedValue(null);

      expect(await service.request('shopper@example.com')).toEqual(OK);
      await flushBackground();

      expect(repository.create).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('answers ok without issuing when the cooldown cannot be checked', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(null);

      expect(await service.request('shopper@example.com')).toEqual(OK);
      await flushBackground();

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('sends no mail when the record could not be stored', async () => {
      repository.create.mockResolvedValue(null);

      await service.request('shopper@example.com');
      await flushBackground();

      expect(email.send).not.toHaveBeenCalled();
    });

    it('sends nothing when earlier records cannot be closed', async () => {
      repository.consumeAllForUser.mockResolvedValue(null);

      expect(await service.request('shopper@example.com')).toEqual(OK);
      await flushBackground();

      expect(repository.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('never logs the raw token or code it mails, at any level', async () => {
      await service.request('shopper@example.com');
      await flushBackground();
      const { token, code } = extractCredentials(email.send.mock.calls[0][0].body as string);

      const logged = JSON.stringify(
        (['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map(
          (level) => logger[level].mock.calls,
        ),
      );
      expect(token).not.toBe('');
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(code);
    });

    it('answers ok, logged, when something throws', async () => {
      email.send.mockRejectedValue(new Error('smtp down'));

      expect(await service.request('shopper@example.com')).toEqual(OK);
      await flushBackground();

      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), userId: 'user-1' },
        'Exception occurred in PasswordResetService.issueInBackground',
      );
    });
  });

  describe('reset — by token', () => {
    it('claims the record, replaces the password, consumes, verifies the address, then announces — in that order', async () => {
      repository.findByTokenHash.mockResolvedValue(resetRow());

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.findByTokenHash).toHaveBeenCalledWith(sha256('raw-token'));
      expect(repository.claim).toHaveBeenCalledWith('pr-1');
      expect(updater.replace).toHaveBeenCalledWith(resetRow().user, NEW_PASSWORD);
      expect(repository.consumeAllForUser).toHaveBeenCalledWith('user-1');
      expect(users.updateEmailVerifiedAt).toHaveBeenCalledWith('user-1');
      expect(repository.release).not.toHaveBeenCalled();

      const order = [
        repository.claim.mock.invocationCallOrder[0],
        updater.replace.mock.invocationCallOrder[0],
        repository.consumeAllForUser.mock.invocationCallOrder[0],
        users.updateEmailVerifiedAt.mock.invocationCallOrder[0],
        updater.announce.mock.invocationCallOrder[0],
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(updater.announce).toHaveBeenCalledWith(resetRow().user);
    });

    it('revokes every session — never keeps one — because a reset has no calling session', async () => {
      repository.findByTokenHash.mockResolvedValue(resetRow());

      await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(updater.replace.mock.calls[0]).toHaveLength(2);
    });

    it('returns no session, no token and no data of any kind', async () => {
      repository.findByTokenHash.mockResolvedValue(resetRow());

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toStrictEqual({ ok: true, data: undefined });
    });

    it('leaves emailVerifiedAt alone on an address that is already verified', async () => {
      repository.findByTokenHash.mockResolvedValue(
        resetRow({ user: makeUser({ emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z') }) }),
      );

      await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(users.updateEmailVerifiedAt).not.toHaveBeenCalled();
    });

    it('answers the identical 400 for an unknown, an expired and an already-used token', async () => {
      repository.findByTokenHash.mockResolvedValueOnce(undefined);
      const unknown = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      repository.findByTokenHash.mockResolvedValueOnce(
        resetRow({ expiresAt: new Date(NOW.getTime() - 1_000) }),
      );
      const expired = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      repository.findByTokenHash.mockResolvedValueOnce(resetRow({ consumedAt: NOW }));
      const consumed = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(unknown).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: RESET_INVALID,
      });
      expect(expired).toEqual(unknown);
      expect(consumed).toEqual(unknown);
      expect(updater.replace).not.toHaveBeenCalled();
    });

    it('accepts a link token whatever the attempt count — the token has no cap', async () => {
      repository.findByTokenHash.mockResolvedValue(resetRow({ attempts: 5 }));

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(updater.replace).toHaveBeenCalled();
    });

    it('answers 503 on a database fault, never 400', async () => {
      repository.findByTokenHash.mockResolvedValue(null);

      expect(await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD })).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: UNAVAILABLE,
      });
    });
  });

  describe('reset — by code', () => {
    it('refuses a code without an email, without looking anything up', async () => {
      const result = await service.reset({ code: '481920', newPassword: NEW_PASSWORD });

      expect(result).toEqual({ ok: false, status: HttpStatus.BAD_REQUEST, message: RESET_INVALID });
      expect(repository.findNewestLiveForEmail).not.toHaveBeenCalled();
    });

    it('completes with the right code', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow());

      const result = await service.reset({
        email: 'Shopper@Example.COM',
        code: '481920',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.findNewestLiveForEmail).toHaveBeenCalledWith('Shopper@Example.COM');
    });

    it('checks the attempt cap before comparing — even the right code is refused at the cap', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow({ attempts: 5 }));

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '481920',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: TOO_MANY,
      });
      expect(updater.replace).not.toHaveBeenCalled();
      expect(repository.incrementAttempts).not.toHaveBeenCalled();
    });

    it('still accepts the right code at 4 wrong attempts — the cap is exactly 5', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow({ attempts: 4 }));

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '481920',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({ ok: true, data: undefined });
    });

    it('answers 400, not 429, on the wrong code that brings the count to 4', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow({ attempts: 3 }));
      repository.incrementAttempts.mockResolvedValue(4);

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '000000',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({ ok: false, status: HttpStatus.BAD_REQUEST, message: RESET_INVALID });
    });

    it('refuses a wrong code at the cap with 429 without counting it — the counter stops at 5', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow({ attempts: 5 }));

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '000000',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: TOO_MANY,
      });
      expect(repository.incrementAttempts).not.toHaveBeenCalled();
    });

    it('counts a wrong code and answers the same 400 as an unknown credential', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow());
      repository.incrementAttempts.mockResolvedValue(1);

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '000000',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({ ok: false, status: HttpStatus.BAD_REQUEST, message: RESET_INVALID });
      expect(repository.incrementAttempts).toHaveBeenCalledWith('pr-1');
    });

    it('answers 429 on the guess that reaches the cap, using the count the database returned', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow({ attempts: 4 }));
      repository.incrementAttempts.mockResolvedValue(5);

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '000000',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: TOO_MANY,
      });
    });

    it('fails closed with 503 when the wrong-code increment cannot be confirmed', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(resetRow());
      repository.incrementAttempts.mockResolvedValue(null);

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '000000',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: UNAVAILABLE,
      });
    });
  });

  describe('reset — after the credential is accepted', () => {
    beforeEach(() => {
      repository.findByTokenHash.mockResolvedValue(resetRow());
    });

    it('returns the policy message verbatim and consumes nothing, so the credential can be retried', async () => {
      updater.replace.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Your password must be at least 12 characters.',
      });

      const result = await service.reset({ token: 'raw-token', newPassword: 'short' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Your password must be at least 12 characters.',
      });
      expect(repository.consumeAllForUser).not.toHaveBeenCalled();
      expect(users.updateEmailVerifiedAt).not.toHaveBeenCalled();
      expect(updater.announce).not.toHaveBeenCalled();
      expect(repository.release).toHaveBeenCalledWith('pr-1', CLAIMED_AT);
    });

    it('passes a 503 from the replace straight through and stops', async () => {
      updater.replace.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: UNAVAILABLE,
      });

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: UNAVAILABLE,
      });
      expect(repository.consumeAllForUser).not.toHaveBeenCalled();
      expect(repository.release).toHaveBeenCalledWith('pr-1', CLAIMED_AT);
    });

    it('answers the replace failure unchanged, and logs, when the claim cannot be released', async () => {
      updater.replace.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Your password must be at least 12 characters.',
      });
      repository.release.mockResolvedValue(null);

      const result = await service.reset({ token: 'raw-token', newPassword: 'short' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Your password must be at least 12 characters.',
      });
      expect(logger.error).toHaveBeenCalledWith(
        { userId: 'user-1', passwordResetId: 'pr-1' },
        'Could not release a claimed reset record after a failed replace',
      );
    });

    it('answers the same 400 as a used credential, and writes nothing, when another redemption claimed the record first', async () => {
      repository.claim.mockResolvedValue(undefined);

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({ ok: false, status: HttpStatus.BAD_REQUEST, message: RESET_INVALID });
      expect(updater.replace).not.toHaveBeenCalled();
      expect(repository.release).not.toHaveBeenCalled();
      expect(updater.announce).not.toHaveBeenCalled();
    });

    it('answers 503, and writes nothing, when the claim cannot be confirmed', async () => {
      repository.claim.mockResolvedValue(null);

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: UNAVAILABLE,
      });
      expect(updater.replace).not.toHaveBeenCalled();
      expect(repository.release).not.toHaveBeenCalled();
    });

    it('refuses with the same 400, and claims and writes nothing, for an account disabled since the record was issued', async () => {
      repository.findByTokenHash.mockResolvedValue(
        resetRow({ user: makeUser({ isActive: false }) }),
      );

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({ ok: false, status: HttpStatus.BAD_REQUEST, message: RESET_INVALID });
      expect(repository.claim).not.toHaveBeenCalled();
      expect(updater.replace).not.toHaveBeenCalled();
    });

    it('refuses with the same 400 for an account that no longer has a password', async () => {
      repository.findByTokenHash.mockResolvedValue(
        resetRow({ user: makeUser({ passwordHash: null }) }),
      );

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({ ok: false, status: HttpStatus.BAD_REQUEST, message: RESET_INVALID });
      expect(updater.replace).not.toHaveBeenCalled();
    });

    it('applies the same eligibility recheck after a right code', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(
        resetRow({ user: makeUser({ isActive: false }) }),
      );

      const result = await service.reset({
        email: 'shopper@example.com',
        code: '481920',
        newPassword: NEW_PASSWORD,
      });

      expect(result).toEqual({ ok: false, status: HttpStatus.BAD_REQUEST, message: RESET_INVALID });
      expect(updater.replace).not.toHaveBeenCalled();
    });

    it('still succeeds, and says so in the log, when the records cannot be consumed afterwards', async () => {
      repository.consumeAllForUser.mockResolvedValue(null);

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(logger.error).toHaveBeenCalled();
      expect(updater.announce).toHaveBeenCalled();
    });

    it('answers 500, logged, and never logs the token or the password, when something throws', async () => {
      updater.replace.mockRejectedValue(new Error('boom'));

      const result = await service.reset({ token: 'raw-token', newPassword: NEW_PASSWORD });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });
      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).not.toContain('raw-token');
      expect(logged).not.toContain(NEW_PASSWORD);
    });
  });
});

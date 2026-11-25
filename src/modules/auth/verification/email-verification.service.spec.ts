import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { Language, User, UserRole } from '../../../infra/prisma/prisma-client';
import { AuthRepository } from '../auth.repository';
import * as codeCompare from '../credentials/emailed-credential';
import {
  EmailVerificationRepository,
  EmailVerificationWithUser,
} from './email-verification.repository';
import { EmailVerificationService } from './email-verification.service';

const NOW = new Date('2026-09-15T00:00:00.000Z');

const userRow = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'shopper@example.com',
  phone: null,
  fullName: 'Aisha Rahman',
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture hash, not a credential
  passwordHash: 'scrypt$hash',
  emailVerifiedAt: null,
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

const verificationRow = (
  overrides: Partial<EmailVerificationWithUser> = {},
): EmailVerificationWithUser => ({
  id: 'ev-1',
  userId: 'user-1',
  email: 'shopper@example.com',
  tokenHash: 'existing-token-hash',
  codeHash: EmailVerificationService.hashCredential('654321'),
  expiresAt: new Date('2026-09-16T00:00:00.000Z'),
  attempts: 0,
  consumedAt: null,
  createdAt: new Date('2026-09-15T00:00:00.000Z'),
  user: userRow(),
  ...overrides,
});

/** Pulls the raw link and code back out of the plain-text body `buildVerificationEmail` sends. */
const extractCredentials = (
  body: string,
): { rawToken: string; rawLink: string; rawCode: string } => {
  const rawLink = /Open this link:\n(.+)/.exec(body)?.[1] ?? '';
  const rawCode = /Or enter this code in the app:\n(\d+)/.exec(body)?.[1] ?? '';
  return { rawLink, rawToken: rawLink.split('token=')[1] ?? '', rawCode };
};

describe('EmailVerificationService', () => {
  let repository: {
    create: jest.Mock;
    findByTokenHash: jest.Mock;
    findNewestLiveForEmail: jest.Mock;
    claimAttempt: jest.Mock;
    refundAttempt: jest.Mock;
    consumeAllForUser: jest.Mock;
  };
  let users: { findByEmail: jest.Mock; updateEmailVerifiedAt: jest.Mock };
  let email: { send: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: EmailVerificationService;

  const config = createMockConfig({
    EMAIL_VERIFICATION_TTL_HOURS: 24,
    APP_PUBLIC_BASE_URL: 'http://localhost:3000',
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    repository = {
      create: jest.fn(),
      findByTokenHash: jest.fn(),
      findNewestLiveForEmail: jest.fn(),
      claimAttempt: jest.fn().mockResolvedValue(1),
      refundAttempt: jest.fn().mockResolvedValue(1),
      consumeAllForUser: jest.fn().mockResolvedValue(1),
    };
    users = {
      findByEmail: jest.fn(),
      updateEmailVerifiedAt: jest.fn().mockResolvedValue(userRow({ emailVerifiedAt: NOW })),
    };
    email = { send: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();

    service = new EmailVerificationService(
      repository as unknown as EmailVerificationRepository,
      users as unknown as AuthRepository,
      email,
      config,
      logger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('issueFor', () => {
    it('mints a 32-byte token and a 6-digit code, stores only their hashes, and mails both', async () => {
      repository.create.mockResolvedValue(verificationRow());

      await service.issueFor(userRow());

      expect(repository.create).toHaveBeenCalledTimes(1);
      const createArgs = repository.create.mock.calls[0][0];
      expect(createArgs.userId).toBe('user-1');
      expect(createArgs.email).toBe('shopper@example.com');

      expect(email.send).toHaveBeenCalledTimes(1);
      const sent = email.send.mock.calls[0][0];
      expect(sent.to).toBe('shopper@example.com');

      const { rawLink, rawToken, rawCode } = extractCredentials(sent.body as string);
      expect(rawLink).toBe(`http://localhost:3000/verify-email?token=${rawToken}`);
      expect(Buffer.from(rawToken, 'base64url')).toHaveLength(32);
      expect(rawCode).toMatch(/^\d{6}$/);

      // The stored hash is never the value that appeared in the email.
      expect(createArgs.tokenHash).not.toBe(rawToken);
      expect(createArgs.tokenHash).toBe(EmailVerificationService.hashCredential(rawToken));
      expect(createArgs.codeHash).not.toBe(rawCode);
      expect(createArgs.codeHash).toBe(EmailVerificationService.hashCredential(rawCode));
    });

    it('never uses Math.random to generate the code', async () => {
      const mathRandomSpy = jest.spyOn(Math, 'random');
      repository.create.mockResolvedValue(verificationRow());

      await service.issueFor(userRow());

      expect(mathRandomSpy).not.toHaveBeenCalled();
      mathRandomSpy.mockRestore();
    });

    it('sends no mail when the record could not be written', async () => {
      repository.create.mockResolvedValue(null);

      await service.issueFor(userRow());

      expect(email.send).not.toHaveBeenCalled();
    });

    it('never throws, even when storing or mailing fails', async () => {
      repository.create.mockRejectedValue(new Error('connection refused'));

      await expect(service.issueFor(userRow())).resolves.toBeUndefined();
    });
  });

  describe('verify — by token', () => {
    it('sets emailVerifiedAt, consumes every live record, and sends the verified email', async () => {
      repository.findByTokenHash.mockResolvedValue(verificationRow());

      const result = await service.verify({ token: 'raw-token' });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.findByTokenHash).toHaveBeenCalledWith(
        EmailVerificationService.hashCredential('raw-token'),
      );
      expect(users.updateEmailVerifiedAt).toHaveBeenCalledWith('user-1');
      expect(repository.consumeAllForUser).toHaveBeenCalledWith('user-1');
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(email.send.mock.calls[0][0].to).toBe('shopper@example.com');
    });

    it('answers the identical 400 for an unknown, an expired, and an already-consumed record', async () => {
      repository.findByTokenHash.mockResolvedValueOnce(undefined);
      const unknown = await service.verify({ token: 'raw-token' });

      repository.findByTokenHash.mockResolvedValueOnce(
        verificationRow({ expiresAt: new Date(NOW.getTime() - 1_000) }),
      );
      const expired = await service.verify({ token: 'raw-token' });

      repository.findByTokenHash.mockResolvedValueOnce(verificationRow({ consumedAt: NOW }));
      const consumed = await service.verify({ token: 'raw-token' });

      expect(unknown).toEqual(expired);
      expect(expired).toEqual(consumed);
      expect(unknown).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'That verification link or code is not valid. Please request a new one.',
      });
    });

    it('answers 503 on a database fault, never 400', async () => {
      repository.findByTokenHash.mockResolvedValue(null);

      const result = await service.verify({ token: 'raw-token' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 503 when the emailVerifiedAt write itself fails', async () => {
      repository.findByTokenHash.mockResolvedValue(verificationRow());
      users.updateEmailVerifiedAt.mockResolvedValue(null);

      const result = await service.verify({ token: 'raw-token' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(repository.consumeAllForUser).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });
  });

  describe('verify — by code', () => {
    it('refuses a code without an email', async () => {
      const result = await service.verify({ code: '654321' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'That verification link or code is not valid. Please request a new one.',
      });
      expect(repository.findNewestLiveForEmail).not.toHaveBeenCalled();
    });

    it('verifies with the correct code, sets emailVerifiedAt, consumes records, and mails confirmation', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow());

      const result = await service.verify({ email: 'shopper@example.com', code: '654321' });

      expect(result).toEqual({ ok: true, data: undefined });
      expect(users.updateEmailVerifiedAt).toHaveBeenCalledWith('user-1');
      expect(repository.consumeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('claims a guess on a wrong code and answers 400 while the count is under the cap', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 1 }));
      repository.claimAttempt.mockResolvedValue(2);

      const result = await service.verify({ email: 'shopper@example.com', code: '000000' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'That verification link or code is not valid. Please request a new one.',
      });
      expect(repository.claimAttempt).toHaveBeenCalledWith('ev-1');
    });

    it('claims the guess BEFORE comparing the code, so a concurrent burst cannot out-guess the cap', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow());
      const compare = jest.spyOn(codeCompare, 'codeMatches');

      await service.verify({ email: 'shopper@example.com', code: '654321' });

      expect(compare).toHaveBeenCalled();
      expect(repository.claimAttempt.mock.invocationCallOrder[0]).toBeLessThan(
        compare.mock.invocationCallOrder[0],
      );
      compare.mockRestore();
    });

    it('never compares the code when no guess slot is left, even for the right code', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 4 }));
      repository.claimAttempt.mockResolvedValue(false);
      const compare = jest.spyOn(codeCompare, 'codeMatches');

      const result = await service.verify({ email: 'shopper@example.com', code: '654321' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many incorrect codes. Please request a new verification email.',
      });
      expect(compare).not.toHaveBeenCalled();
      expect(users.updateEmailVerifiedAt).not.toHaveBeenCalled();
      compare.mockRestore();
    });

    it('answers 429 on the wrong guess that takes the count to the cap, using the count the database returned', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 4 }));
      repository.claimAttempt.mockResolvedValue(5);

      const result = await service.verify({ email: 'shopper@example.com', code: '000000' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many incorrect codes. Please request a new verification email.',
      });
    });

    it('still accepts the right code on the fifth guess', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 4 }));
      repository.claimAttempt.mockResolvedValue(5);

      const result = await service.verify({ email: 'shopper@example.com', code: '654321' });

      expect(result).toEqual({ ok: true, data: undefined });
    });

    it('answers 400 for the first four sequential wrong guesses and 429 for the fifth', async () => {
      let attempts = 0;
      repository.findNewestLiveForEmail.mockImplementation(() =>
        Promise.resolve(verificationRow({ attempts })),
      );
      repository.claimAttempt.mockImplementation(() => {
        if (attempts >= 5) return Promise.resolve(false);
        attempts += 1;
        return Promise.resolve(attempts);
      });

      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const result = await service.verify({ email: 'shopper@example.com', code: '000000' });
        statuses.push(result.ok ? 200 : result.status);
      }

      expect(statuses).toEqual([400, 400, 400, 400, 429, 429]);
    });

    it('refunds the claimed slot when a correct code then fails on the emailVerifiedAt write', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 4 }));
      repository.claimAttempt.mockResolvedValue(5);
      users.updateEmailVerifiedAt.mockResolvedValue(null);

      const result = await service.verify({ email: 'shopper@example.com', code: '654321' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(repository.refundAttempt).toHaveBeenCalledWith('ev-1');
    });

    it('never refunds a wrong guess', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 1 }));
      repository.claimAttempt.mockResolvedValue(2);

      await service.verify({ email: 'shopper@example.com', code: '000000' });

      expect(repository.refundAttempt).not.toHaveBeenCalled();
    });

    it('answers 503, not 400, when the claim write itself fails, and never compares the code', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 1 }));
      repository.claimAttempt.mockResolvedValue(null);
      const compare = jest.spyOn(codeCompare, 'codeMatches');

      const result = await service.verify({ email: 'shopper@example.com', code: '000000' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(compare).not.toHaveBeenCalled();
      compare.mockRestore();
    });

    it('answers 503 on a database fault, never 400', async () => {
      repository.findNewestLiveForEmail.mockResolvedValue(null);

      const result = await service.verify({ email: 'shopper@example.com', code: '654321' });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });
  });

  describe('resend', () => {
    it('does nothing and still answers ok inside the 60-second cooldown', async () => {
      users.findByEmail.mockResolvedValue(userRow({ emailVerifiedAt: null }));
      repository.findNewestLiveForEmail.mockResolvedValue(
        verificationRow({ createdAt: new Date(NOW.getTime() - 30_000) }),
      );

      const result = await service.resend('shopper@example.com');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.consumeAllForUser).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('consumes live records and issues exactly one new one outside the cooldown', async () => {
      users.findByEmail.mockResolvedValue(userRow({ emailVerifiedAt: null }));
      repository.findNewestLiveForEmail.mockResolvedValue(
        verificationRow({ createdAt: new Date(NOW.getTime() - 61_000) }),
      );
      repository.create.mockResolvedValue(verificationRow());

      const result = await service.resend('shopper@example.com');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.consumeAllForUser).toHaveBeenCalledWith('user-1');
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('mails nothing and still answers ok for an unknown address', async () => {
      users.findByEmail.mockResolvedValue(undefined);

      const result = await service.resend('nobody@example.com');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(email.send).not.toHaveBeenCalled();
      expect(repository.findNewestLiveForEmail).not.toHaveBeenCalled();
    });

    it('mails nothing and still answers ok for an already-verified address', async () => {
      users.findByEmail.mockResolvedValue(
        userRow({ emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z') }),
      );

      const result = await service.resend('shopper@example.com');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(email.send).not.toHaveBeenCalled();
    });

    it('mails nothing and still answers ok on a database fault reading the account', async () => {
      users.findByEmail.mockResolvedValue(null);

      const result = await service.resend('shopper@example.com');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(email.send).not.toHaveBeenCalled();
    });

    it('does nothing and still answers ok when the cooldown cannot be checked', async () => {
      users.findByEmail.mockResolvedValue(userRow({ emailVerifiedAt: null }));
      repository.findNewestLiveForEmail.mockResolvedValue(null);

      const result = await service.resend('shopper@example.com');

      expect(result).toEqual({ ok: true, data: undefined });
      expect(repository.consumeAllForUser).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });
  });

  describe('security: no credential leakage in logs', () => {
    it('never logs a raw token, a raw code, or their hashes', async () => {
      repository.create.mockResolvedValue(verificationRow());
      await service.issueFor(userRow());
      const createArgs = repository.create.mock.calls[0][0];
      const { rawToken, rawCode } = extractCredentials(email.send.mock.calls[0][0].body as string);

      // Exercise the paths most likely to leak: the store-failed path and a wrong-code attempt.
      repository.create.mockResolvedValueOnce(null);
      await service.issueFor(userRow());

      repository.findNewestLiveForEmail.mockResolvedValue(verificationRow({ attempts: 1 }));
      await service.verify({ email: 'shopper@example.com', code: '111111' });

      const loggedText = JSON.stringify([
        ...logger.error.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.info.mock.calls,
      ]);

      expect(loggedText).not.toContain(rawToken);
      expect(loggedText).not.toContain(rawCode);
      expect(loggedText).not.toContain(createArgs.tokenHash);
      expect(loggedText).not.toContain(createArgs.codeHash);
    });
  });
});

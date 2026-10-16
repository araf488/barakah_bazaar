import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { UserRole } from '../../../infra/prisma/prisma-client';
import * as credentials from '../credentials/emailed-credential';
import { hashCredential } from '../credentials/emailed-credential';
import { PhoneVerificationService } from './phone-verification.service';

const user: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  email: 'aisha@example.com',
  role: UserRole.CUSTOMER,
};
/** A database fault answers 503 with this exact body. */
const DATABASE_UNAVAILABLE = {
  ok: false,
  status: 503,
  message: 'The service is temporarily unavailable. Please try again shortly.',
};
const MINTED_CODE = '482913';
const limits = { cooldownSeconds: 60, perNumberDaily: 5, globalDaily: 500 };
const liveRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ver-1',
  userId: 'user-1',
  phone: '+8801712345678',
  codeHash: hashCredential(MINTED_CODE),
  expiresAt: new Date(Date.now() + 60_000),
  attempts: 0,
  consumedAt: null,
  ...overrides,
});

describe('PhoneVerificationService', () => {
  let users: { findByPhone: jest.Mock };
  let repository: {
    accountLimitReached: jest.Mock;
    issue: jest.Mock;
    findNewestLive: jest.Mock;
    claimAttempt: jest.Mock;
    confirm: jest.Mock;
  };
  let issuer: {
    mint: jest.Mock;
    limits: jest.Mock;
    accountDailyLimit: jest.Mock;
    send: jest.Mock;
    reportDailyLimit: jest.Mock;
  };
  let email: { send: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: PhoneVerificationService;

  beforeEach(() => {
    users = { findByPhone: jest.fn().mockResolvedValue(undefined) };
    repository = {
      accountLimitReached: jest.fn().mockResolvedValue(false),
      issue: jest.fn().mockResolvedValue({ kind: 'issued' }),
      findNewestLive: jest.fn().mockResolvedValue(liveRow()),
      claimAttempt: jest.fn().mockResolvedValue(true),
      confirm: jest.fn().mockResolvedValue({ kind: 'confirmed', fullName: 'Aisha Rahman' }),
    };
    issuer = {
      mint: jest.fn().mockReturnValue({
        code: MINTED_CODE,
        codeHash: hashCredential(MINTED_CODE),
        expiresAt: new Date('2026-10-16T00:05:00.000Z'),
      }),
      limits: jest.fn().mockReturnValue(limits),
      accountDailyLimit: jest.fn().mockReturnValue(5),
      reportDailyLimit: jest.fn(),
      send: jest.fn().mockResolvedValue(true),
    };
    email = { send: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    service = new PhoneVerificationService(
      users as never,
      repository as never,
      issuer as never,
      email,
      logger,
    );
  });

  describe('request', () => {
    const dto = { phone: '01712345678' };

    it('stores a code for the normalised number, texts it, and answers the timings', async () => {
      const result = await service.request(user, { phone: ' 01712345678 ' });

      expect(result).toEqual({ ok: true, data: { expiresInSeconds: 300, resendAfterSeconds: 60 } });
      expect(users.findByPhone).toHaveBeenCalledWith('+8801712345678');
      expect(repository.issue).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          phone: '+8801712345678',
          codeHash: hashCredential(MINTED_CODE),
          expiresAt: new Date('2026-10-16T00:05:00.000Z'),
        },
        limits,
        5,
      );
      expect(issuer.send).toHaveBeenCalledWith('+8801712345678', MINTED_CODE);
    });

    it('never puts the code in any result', async () => {
      const results = [
        await service.request(user, dto),
        await (async () => {
          issuer.send.mockResolvedValue(false);
          return service.request(user, dto);
        })(),
      ];

      expect(JSON.stringify(results)).not.toContain(MINTED_CODE);
    });

    describe('when the account has already spent its daily sends', () => {
      const CAPPED = {
        ok: false,
        status: 429,
        message:
          'Too many verification codes were requested for this account today. Try again tomorrow.',
      };

      beforeEach(() => repository.accountLimitReached.mockResolvedValue(true));

      it.each([
        ['a number another account holds', { id: 'user-2', phoneVerifiedAt: new Date() }],
        ["the caller's own verified number", { id: 'user-1', phoneVerifiedAt: new Date() }],
        ['an unregistered number', undefined],
      ])('answers the identical 429 for %s, and never looks the number up', async (_, holder) => {
        users.findByPhone.mockResolvedValue(holder);

        expect(await service.request(user, dto)).toEqual(CAPPED);
        expect(users.findByPhone).not.toHaveBeenCalled();
        expect(repository.issue).not.toHaveBeenCalled();
        expect(issuer.send).not.toHaveBeenCalled();
      });

      it('asks with the caller id and the configured daily limit', async () => {
        await service.request(user, dto);

        expect(repository.accountLimitReached).toHaveBeenCalledWith('user-1', 5);
      });
    });

    it('checks the account cap before it looks the number up', async () => {
      await service.request(user, dto);

      expect(repository.accountLimitReached.mock.invocationCallOrder[0]).toBeLessThan(
        users.findByPhone.mock.invocationCallOrder[0],
      );
    });

    it('answers 503 when the account cap check faults, before any lookup', async () => {
      repository.accountLimitReached.mockResolvedValue(null);

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 503,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(users.findByPhone).not.toHaveBeenCalled();
      expect(repository.issue).not.toHaveBeenCalled();
    });

    it('answers 503 when the number lookup faults', async () => {
      users.findByPhone.mockResolvedValue(null);

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 503,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
      expect(repository.issue).not.toHaveBeenCalled();
    });

    it('answers 409 when another account holds the number', async () => {
      users.findByPhone.mockResolvedValue({ id: 'user-2', phoneVerifiedAt: new Date() });

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 409,
        message: 'This number is already linked to another account.',
      });
      expect(repository.issue).not.toHaveBeenCalled();
    });

    it('answers 409 when the number is already verified on the caller', async () => {
      users.findByPhone.mockResolvedValue({ id: 'user-1', phoneVerifiedAt: new Date() });

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 409,
        message: 'This number is already verified on your account.',
      });
      expect(repository.issue).not.toHaveBeenCalled();
    });

    it("lets the caller's own unverified legacy number proceed to issue", async () => {
      users.findByPhone.mockResolvedValue({ id: 'user-1', phoneVerifiedAt: null });

      const result = await service.request(user, dto);

      expect(result.ok).toBe(true);
      expect(repository.issue).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when the issue write faults', async () => {
      repository.issue.mockResolvedValue(null);

      expect(await service.request(user, dto)).toEqual(DATABASE_UNAVAILABLE);
      expect(issuer.send).not.toHaveBeenCalled();
    });

    it('answers 503 and reports when the global SMS limit is reached', async () => {
      repository.issue.mockResolvedValue({ kind: 'global-limit' });

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 503,
        message: 'Text messages are unavailable right now. Please try again later.',
      });
      expect(issuer.reportDailyLimit).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
      expect(issuer.send).not.toHaveBeenCalled();
    });

    it('answers 429 with the seconds left when inside the cooldown', async () => {
      repository.issue.mockResolvedValue({ kind: 'cooldown', retryAfterSeconds: 42 });

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 429,
        message: 'Please wait 42 seconds before requesting another code.',
      });
      expect(issuer.send).not.toHaveBeenCalled();
    });

    it('answers 429 when the number reached its daily limit', async () => {
      repository.issue.mockResolvedValue({ kind: 'number-limit' });

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 429,
        message: 'Too many codes were requested for this number today. Try again tomorrow.',
      });
    });

    it('answers 429 and texts nothing when the account reached its daily limit', async () => {
      repository.issue.mockResolvedValue({ kind: 'account-limit' });

      expect(await service.request(user, dto)).toEqual({
        ok: false,
        status: 429,
        message:
          'Too many verification codes were requested for this account today. Try again tomorrow.',
      });
      expect(issuer.send).not.toHaveBeenCalled();
    });

    it('hands the configured per-account limit to the issue', async () => {
      issuer.accountDailyLimit.mockReturnValue(3);

      await service.request(user, dto);

      expect(repository.issue).toHaveBeenCalledWith(expect.anything(), limits, 3);
    });

    it('stores the code before texting it, and a failed text rolls nothing back', async () => {
      issuer.send.mockResolvedValue(false);

      const result = await service.request(user, dto);

      expect(result).toEqual({
        ok: false,
        status: 503,
        message: 'Text messages are unavailable right now. Please try again later.',
      });
      expect(repository.issue).toHaveBeenCalledTimes(1);
      expect(repository.issue.mock.invocationCallOrder[0]).toBeLessThan(
        issuer.send.mock.invocationCallOrder[0],
      );
    });

    it('answers 500 and logs when something throws', async () => {
      const failure = new Error('boom');
      users.findByPhone.mockRejectedValue(failure);

      expect(await service.request(user, dto)).toMatchObject({ ok: false, status: 500 });
      expect(logger.error).toHaveBeenCalledWith(
        { err: failure, userId: 'user-1' },
        'Exception occurred in PhoneVerificationService.request',
      );
    });
  });

  describe('confirm', () => {
    const dto = { phone: '01712345678', code: MINTED_CODE };

    it('writes the number and answers it normalised', async () => {
      const result = await service.confirm(user, { ...dto, phone: ' 01712345678 ' });

      expect(result).toEqual({ ok: true, data: { phone: '+8801712345678', phoneVerified: true } });
      expect(repository.findNewestLive).toHaveBeenCalledWith('user-1', '+8801712345678');
      expect(repository.confirm).toHaveBeenCalledWith('ver-1', 'user-1', '+8801712345678');
    });

    it('answers 503 when the code lookup faults', async () => {
      repository.findNewestLive.mockResolvedValue(null);

      expect(await service.confirm(user, dto)).toEqual(DATABASE_UNAVAILABLE);
    });

    it('answers 410 when no live code exists for that number, touching nothing', async () => {
      repository.findNewestLive.mockResolvedValue(undefined);

      expect(await service.confirm(user, { ...dto, phone: '01812345678' })).toEqual({
        ok: false,
        status: 410,
        message: 'That code has expired. Request a new one.',
      });
      expect(repository.findNewestLive).toHaveBeenCalledWith('user-1', '+8801812345678');
      expect(repository.claimAttempt).not.toHaveBeenCalled();
      expect(repository.confirm).not.toHaveBeenCalled();
    });

    it('answers 410 for an expired code', async () => {
      repository.findNewestLive.mockResolvedValue(liveRow({ expiresAt: new Date(Date.now() - 1) }));

      expect(await service.confirm(user, dto)).toMatchObject({ ok: false, status: 410 });
      expect(repository.confirm).not.toHaveBeenCalled();
    });

    it('answers 410, never comparing the code, when no guess slot is left', async () => {
      repository.claimAttempt.mockResolvedValue(false);

      expect(await service.confirm(user, dto)).toEqual({
        ok: false,
        status: 410,
        message: 'That code has expired. Request a new one.',
      });
      expect(repository.confirm).not.toHaveBeenCalled();
    });

    it('claims the guess slot before comparing the code', async () => {
      const compare = jest.spyOn(credentials, 'codeMatches');

      await service.confirm(user, dto);

      expect(repository.claimAttempt).toHaveBeenCalledWith('ver-1');
      expect(repository.claimAttempt.mock.invocationCallOrder[0]).toBeLessThan(
        compare.mock.invocationCallOrder[0],
      );
      compare.mockRestore();
    });

    it('does not compare the code at all when the claim is refused', async () => {
      const compare = jest.spyOn(credentials, 'codeMatches');
      repository.claimAttempt.mockResolvedValue(false);

      await service.confirm(user, dto);

      expect(compare).not.toHaveBeenCalled();
      compare.mockRestore();
    });

    it('answers 503 when claiming the slot faults', async () => {
      repository.claimAttempt.mockResolvedValue(null);

      expect(await service.confirm(user, dto)).toEqual(DATABASE_UNAVAILABLE);
      expect(repository.confirm).not.toHaveBeenCalled();
    });

    it('answers 400 for a wrong code after a claimed slot, with no second write', async () => {
      expect(await service.confirm(user, { ...dto, code: '000000' })).toEqual({
        ok: false,
        status: 400,
        message: 'That code is not correct.',
      });
      expect(repository.claimAttempt).toHaveBeenCalledTimes(1);
      expect(repository.confirm).not.toHaveBeenCalled();
    });

    it('proceeds to confirm for the right code after a claimed slot', async () => {
      expect((await service.confirm(user, dto)).ok).toBe(true);
      expect(repository.confirm).toHaveBeenCalledWith('ver-1', 'user-1', '+8801712345678');
    });

    it('answers 503 when the confirm write faults', async () => {
      repository.confirm.mockResolvedValue(null);

      expect(await service.confirm(user, dto)).toEqual(DATABASE_UNAVAILABLE);
    });

    it('answers 410 when the code was spent by a concurrent confirm', async () => {
      repository.confirm.mockResolvedValue({ kind: 'already-used' });

      expect(await service.confirm(user, dto)).toEqual({
        ok: false,
        status: 410,
        message: 'That code has expired. Request a new one.',
      });
    });

    it('answers 409 when another account took the number meanwhile', async () => {
      repository.confirm.mockResolvedValue({ kind: 'phone-in-use' });

      expect(await service.confirm(user, dto)).toEqual({
        ok: false,
        status: 409,
        message: 'This number is already linked to another account.',
      });
    });

    it('answers 500 and logs when something throws', async () => {
      const failure = new Error('boom');
      repository.findNewestLive.mockRejectedValue(failure);

      expect(await service.confirm(user, dto)).toMatchObject({ ok: false, status: 500 });
      expect(logger.error).toHaveBeenCalledWith(
        { err: failure, userId: 'user-1' },
        'Exception occurred in PhoneVerificationService.confirm',
      );
    });

    describe('linked-number email', () => {
      it('is sent on a first link, to the account email, by name, with only the last 3 digits', async () => {
        await service.confirm(user, dto);

        expect(email.send).toHaveBeenCalledTimes(1);
        const message = email.send.mock.calls[0][0];
        expect(message.to).toBe('aisha@example.com');
        expect(message.subject).toBe('A phone number was linked to your account');
        for (const text of [message.body, message.html]) {
          expect(text).toContain('Hello Aisha,');
          expect(text).toContain('ending in 678.');
          expect(text).not.toContain('01712345678');
          expect(text).not.toContain('8801712345678');
        }
      });

      it('is sent when the number replaces another, and when a legacy number is verified', async () => {
        await service.confirm(user, dto);
        await service.confirm(user, { ...dto, phone: '01812345678' });

        expect(email.send).toHaveBeenCalledTimes(2);
      });

      it('greets plainly when the account has no name', async () => {
        repository.confirm.mockResolvedValue({ kind: 'confirmed', fullName: null });

        await service.confirm(user, dto);

        const [message] = email.send.mock.calls[0] as [{ body: string }];
        expect(message.body.startsWith('Hello,')).toBe(true);
      });

      it('is not sent when the confirm did not link the number', async () => {
        repository.confirm.mockResolvedValue({ kind: 'phone-in-use' });

        await service.confirm(user, dto);

        expect(email.send).not.toHaveBeenCalled();
      });

      it('never fails the response when the email cannot be sent', async () => {
        const failure = new Error('smtp down');
        email.send.mockRejectedValue(failure);

        const result = await service.confirm(user, dto);

        expect(result).toEqual({
          ok: true,
          data: { phone: '+8801712345678', phoneVerified: true },
        });
        expect(logger.warn).toHaveBeenCalledWith(
          { err: failure, userId: 'user-1' },
          'Phone changed email could not be sent',
        );
      });
    });
  });
});

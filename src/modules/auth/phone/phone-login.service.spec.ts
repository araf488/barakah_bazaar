import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { User, UserRole } from '../../../infra/prisma/prisma-client';
import { hashCredential } from '../credentials/emailed-credential';
import { PhoneLoginService } from './phone-login.service';

/** A database fault answers 503 with this exact body. */
const DATABASE_UNAVAILABLE = {
  ok: false,
  status: 503,
  message: 'The service is temporarily unavailable. Please try again shortly.',
};

const NOW = new Date('2026-10-16T12:00:00.000Z');
const PHONE = '+8801712345678';
const CODE = '012345';
const INVALID = { ok: false, status: 401, message: 'Those sign-in details are not correct.' };
const SENT = { ok: true, data: { expiresInSeconds: 300, resendAfterSeconds: 60 } };

const userRow = (over: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'customer@example.com',
    phone: PHONE,
    phoneVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    isActive: true,
    ...over,
  }) as User;

const challengeRow = (over: Record<string, unknown> = {}) => ({
  id: 'challenge-1',
  userId: 'user-1',
  phone: PHONE,
  codeHash: hashCredential(CODE),
  attempts: 0,
  consumedAt: null,
  expiresAt: new Date(NOW.getTime() + 300_000),
  user: userRow(),
  ...over,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('PhoneLoginService', () => {
  let users: { findByPhone: jest.Mock };
  let challenges: {
    issue: jest.Mock;
    findNewestLiveForPhone: jest.Mock;
    claimAttempt: jest.Mock;
    consume: jest.Mock;
    globalLimitReached: jest.Mock;
  };
  let issuer: {
    mint: jest.Mock;
    limits: jest.Mock;
    send: jest.Mock;
    reportDailyLimit: jest.Mock;
  };
  let login: { completeLogin: jest.Mock };
  let events: { recordLoginFailed: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: PhoneLoginService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    users = { findByPhone: jest.fn().mockResolvedValue(userRow()) };
    challenges = {
      issue: jest.fn().mockResolvedValue({ kind: 'issued' }),
      findNewestLiveForPhone: jest.fn().mockResolvedValue(challengeRow()),
      claimAttempt: jest.fn().mockResolvedValue(true),
      consume: jest.fn().mockResolvedValue(true),
      globalLimitReached: jest.fn().mockResolvedValue(false),
    };
    issuer = {
      reportDailyLimit: jest.fn(),
      mint: jest.fn().mockReturnValue({
        code: CODE,
        codeHash: hashCredential(CODE),
        expiresAt: new Date(NOW.getTime() + 300_000),
      }),
      limits: jest
        .fn()
        .mockReturnValue({ cooldownSeconds: 60, perNumberDaily: 5, globalDaily: 500 }),
      send: jest.fn().mockResolvedValue(true),
    };
    login = { completeLogin: jest.fn().mockResolvedValue({ ok: true, data: { kind: 'session' } }) };
    events = { recordLoginFailed: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    service = new PhoneLoginService(
      users as never,
      challenges as never,
      issuer as never,
      login as never,
      events as never,
      logger,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('request', () => {
    const request = (phone = '01712345678') => service.request({ phone }, '203.0.113.7');

    it('texts a code to an eligible customer and answers 202 data without the code', async () => {
      const result = await request();

      expect(result).toStrictEqual(SENT);
      expect(JSON.stringify(result)).not.toContain(CODE);
      expect(challenges.issue).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          phone: PHONE,
          codeHash: hashCredential(CODE),
          expiresAt: new Date(NOW.getTime() + 300_000),
          ipAddress: '203.0.113.7',
        },
        { cooldownSeconds: 60, perNumberDaily: 5, globalDaily: 500 },
      );
      expect(issuer.send).toHaveBeenCalledWith(PHONE, CODE);
    });

    it('looks the account up by the normalised number', async () => {
      await request('+8801712345678');

      expect(users.findByPhone).toHaveBeenCalledWith(PHONE);
    });

    it.each([
      ['unknown', undefined],
      ['unverified', userRow({ phoneVerifiedAt: null })],
      ['staff', userRow({ role: UserRole.SUPPORT })],
      ['inactive', userRow({ isActive: false })],
    ])(
      'answers an %s number exactly like an eligible one, writing and sending nothing',
      async (_n, row) => {
        users.findByPhone.mockResolvedValue(row);

        expect(await request()).toStrictEqual(SENT);
        expect(challenges.issue).not.toHaveBeenCalled();
        expect(issuer.send).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['cooldown', { kind: 'cooldown', retryAfterSeconds: 30 }],
      ['number-limit', { kind: 'number-limit' }],
      ['global-limit', { kind: 'global-limit' }],
    ])('answers the same body on %s and sends nothing', async (_n, verdict) => {
      challenges.issue.mockResolvedValue(verdict);

      expect(await request()).toStrictEqual(SENT);
      expect(issuer.send).not.toHaveBeenCalled();
    });

    it('reports a global limit hit during issue to the rate-limited alert', async () => {
      challenges.issue.mockResolvedValue({ kind: 'global-limit' });

      await request();

      expect(issuer.reportDailyLimit).toHaveBeenCalledTimes(1);
    });

    it('answers 503 SmsUnavailable and reports when the global pre-check is over the limit', async () => {
      challenges.globalLimitReached.mockResolvedValue(true);

      expect(await request()).toEqual({
        ok: false,
        status: 503,
        message: 'Text messages are unavailable right now. Please try again later.',
      });
      expect(issuer.reportDailyLimit).toHaveBeenCalledTimes(1);
      // Through the rate-limited alert only: a public request must not log at error itself.
      expect(logger.error).not.toHaveBeenCalled();
      expect(users.findByPhone).not.toHaveBeenCalled();
    });

    it('passes the configured global ceiling to the pre-check', async () => {
      await request();

      expect(challenges.globalLimitReached).toHaveBeenCalledWith(500);
    });

    it('answers 503 when the pre-check faults', async () => {
      challenges.globalLimitReached.mockResolvedValue(null);

      expect(await request()).toEqual(DATABASE_UNAVAILABLE);
    });

    it('answers 503 when the account lookup faults', async () => {
      users.findByPhone.mockResolvedValue(null);

      expect(await request()).toEqual(DATABASE_UNAVAILABLE);
    });

    it('answers 503 when issue faults', async () => {
      challenges.issue.mockResolvedValue(null);

      expect(await request()).toEqual(DATABASE_UNAVAILABLE);
    });

    it('answers 202 before a never-resolving send settles', async () => {
      issuer.send.mockReturnValue(new Promise<boolean>(() => undefined));

      expect(await request()).toStrictEqual(SENT);
      expect(issuer.send).toHaveBeenCalledWith(PHONE, CODE);
    });

    it('still answers 202 and logs when the gateway refuses the text', async () => {
      issuer.send.mockResolvedValue(false);

      expect(await request()).toStrictEqual(SENT);
      await flush();
      expect(logger.error).toHaveBeenCalledWith('Phone sign-in code could not be sent');
    });

    it('still answers 202 and logs when the gateway throws', async () => {
      issuer.send.mockRejectedValue(new Error('timeout'));

      expect(await request()).toStrictEqual(SENT);
      await flush();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Phone sign-in code could not be sent',
      );
    });

    it('answers 500 and logs when something throws', async () => {
      users.findByPhone.mockRejectedValue(new Error('boom'));

      expect(await request()).toMatchObject({ ok: false, status: 500 });
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Exception occurred in PhoneLoginService.request',
      );
    });
  });

  describe('verify', () => {
    const verify = (code = CODE, phone = '01712345678') =>
      service.verify({ phone, code }, 'device-1', 'ua', '203.0.113.7');

    it('completes the login for the challenge owner and passes the result through', async () => {
      const result = await verify();

      expect(result).toEqual({ ok: true, data: { kind: 'session' } });
      expect(login.completeLogin).toHaveBeenCalledWith(userRow(), 'device-1', 'ua', '203.0.113.7');
    });

    it('looks the challenge up by the normalised number', async () => {
      await verify(CODE, '+8801712345678');

      expect(challenges.findNewestLiveForPhone).toHaveBeenCalledWith(PHONE);
    });

    it('claims the guess slot before comparing, and consumes before logging in', async () => {
      await verify();

      expect(challenges.claimAttempt).toHaveBeenCalledWith('challenge-1');
      expect(challenges.claimAttempt.mock.invocationCallOrder[0]).toBeLessThan(
        challenges.consume.mock.invocationCallOrder[0],
      );
      expect(challenges.consume.mock.invocationCallOrder[0]).toBeLessThan(
        login.completeLogin.mock.invocationCallOrder[0],
      );
    });

    it('answers a wrong code 401 and records the failure against the owner, with no second write', async () => {
      expect(await verify('999999')).toEqual(INVALID);

      expect(challenges.claimAttempt).toHaveBeenCalledTimes(1);
      expect(challenges.consume).not.toHaveBeenCalled();
      expect(events.recordLoginFailed).toHaveBeenCalledWith(userRow(), {
        sessionId: '',
        deviceId: 'device-1',
        userAgent: 'ua',
        ip: '203.0.113.7',
      });
      expect(login.completeLogin).not.toHaveBeenCalled();
    });

    it('answers no challenge, expired and consumed identically', async () => {
      challenges.findNewestLiveForPhone.mockResolvedValue(undefined);
      expect(await verify()).toEqual(INVALID);

      challenges.findNewestLiveForPhone.mockResolvedValue(
        challengeRow({ expiresAt: new Date(NOW.getTime() - 1) }),
      );
      expect(await verify()).toEqual(INVALID);

      challenges.findNewestLiveForPhone.mockResolvedValue(challengeRow({ consumedAt: NOW }));
      expect(await verify()).toEqual(INVALID);

      expect(challenges.claimAttempt).not.toHaveBeenCalled();
      expect(events.recordLoginFailed).not.toHaveBeenCalled();
    });

    it('claims the guess slot before the compare runs, even for a wrong code', async () => {
      await verify('999999');

      expect(challenges.claimAttempt.mock.invocationCallOrder[0]).toBeLessThan(
        events.recordLoginFailed.mock.invocationCallOrder[0],
      );
    });

    it('never compares when the claim is refused: a wrong code records no failure', async () => {
      challenges.claimAttempt.mockResolvedValue(false);

      expect(await verify('999999')).toEqual(INVALID);
      expect(events.recordLoginFailed).not.toHaveBeenCalled();
    });

    it('never compares when the claim faults', async () => {
      challenges.claimAttempt.mockResolvedValue(null);

      expect(await verify('999999')).toEqual(DATABASE_UNAVAILABLE);
      expect(events.recordLoginFailed).not.toHaveBeenCalled();
    });

    it('answers 401 when the attempt cap is already spent, without comparing', async () => {
      challenges.claimAttempt.mockResolvedValue(false);

      expect(await verify()).toEqual(INVALID);
      expect(challenges.consume).not.toHaveBeenCalled();
      expect(login.completeLogin).not.toHaveBeenCalled();
    });

    it('answers 503 when the lookup faults', async () => {
      challenges.findNewestLiveForPhone.mockResolvedValue(null);

      expect(await verify()).toEqual(DATABASE_UNAVAILABLE);
    });

    it('answers 503 when the claim faults', async () => {
      challenges.claimAttempt.mockResolvedValue(null);

      expect(await verify()).toEqual(DATABASE_UNAVAILABLE);
    });

    it('answers 503 when consume faults', async () => {
      challenges.consume.mockResolvedValue(null);

      expect(await verify()).toEqual(DATABASE_UNAVAILABLE);
      expect(login.completeLogin).not.toHaveBeenCalled();
    });

    it('answers 401 when another request consumed the code first', async () => {
      challenges.consume.mockResolvedValue(false);

      expect(await verify()).toEqual(INVALID);
      expect(login.completeLogin).not.toHaveBeenCalled();
    });

    it('answers 401 when the customer changed number after the code was requested', async () => {
      challenges.findNewestLiveForPhone.mockResolvedValue(
        challengeRow({ user: userRow({ phone: '+8801812345678' }) }),
      );

      expect(await verify()).toEqual(INVALID);
      expect(login.completeLogin).not.toHaveBeenCalled();
    });

    it('answers 401 when the number is no longer verified', async () => {
      challenges.findNewestLiveForPhone.mockResolvedValue(
        challengeRow({ user: userRow({ phoneVerifiedAt: null }) }),
      );

      expect(await verify()).toEqual(INVALID);
      expect(login.completeLogin).not.toHaveBeenCalled();
    });

    it('answers 401 when the account became staff', async () => {
      challenges.findNewestLiveForPhone.mockResolvedValue(
        challengeRow({ user: userRow({ role: UserRole.SUPPORT }) }),
      );

      expect(await verify()).toEqual(INVALID);
      expect(login.completeLogin).not.toHaveBeenCalled();
    });

    it('answers 500 and logs when something throws, never logging the code', async () => {
      challenges.findNewestLiveForPhone.mockRejectedValue(new Error('boom'));

      expect(await verify()).toMatchObject({ ok: false, status: 500 });
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Exception occurred in PhoneLoginService.verify',
      );
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(CODE);
    });
  });
});

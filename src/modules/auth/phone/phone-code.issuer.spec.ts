import { createHash } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { PhoneCodeIssuer } from './phone-code.issuer';

describe('PhoneCodeIssuer', () => {
  let gateway: { send: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let issuer: PhoneCodeIssuer;

  beforeEach(() => {
    gateway = { send: jest.fn().mockResolvedValue(true) };
    logger = createMockLogger();
    issuer = new PhoneCodeIssuer(
      gateway,
      createMockConfig({
        PHONE_CODE_RESEND_COOLDOWN_SECONDS: 60,
        PHONE_CODE_DAILY_LIMIT_PER_NUMBER: 5,
        PHONE_CODE_DAILY_LIMIT_PER_ACCOUNT: 7,
        SMS_DAILY_LIMIT: 500,
      }),
      logger,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('reads the three limits from config', () => {
    expect(issuer.limits()).toEqual({ cooldownSeconds: 60, perNumberDaily: 5, globalDaily: 500 });
  });

  it('reads the per-account daily verification limit from config', () => {
    expect(issuer.accountDailyLimit()).toBe(7);
  });

  it('mints a 6-digit code, its SHA-256 base64url hash and a 300 s deadline', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T12:00:00.000Z'));

    const minted = issuer.mint();

    expect(minted.code).toMatch(/^\d{6}$/);
    expect(minted.codeHash).toBe(createHash('sha256').update(minted.code).digest('base64url'));
    expect(minted.expiresAt).toEqual(new Date('2026-10-16T12:05:00.000Z'));
  });

  it('sends the formatted ASCII message to the number', async () => {
    expect(await issuer.send('+8801712345678', '482913')).toBe(true);

    expect(gateway.send).toHaveBeenCalledWith({
      to: '+8801712345678',
      body: 'Barakah Bazaar code: 482913. Valid 5 minutes. Never share it.',
    });
  });

  it('is false when the gateway declines', async () => {
    gateway.send.mockResolvedValue(false);
    expect(await issuer.send('+8801712345678', '482913')).toBe(false);
  });

  it('is false when the gateway throws, logging neither the code nor the full number', async () => {
    gateway.send.mockRejectedValue(new Error('boom'));

    expect(await issuer.send('+8801712345678', '482913')).toBe(false);
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('482913');
    expect(logged).not.toContain('+8801712345678');
    expect(logged).toContain('678');
  });

  describe('reportDailyLimit', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-16T12:00:00.000Z')));

    it('logs the first hit at error', () => {
      issuer.reportDailyLimit();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith({ suppressed: 0 }, 'SMS daily limit reached');
    });

    it('stays quiet for every further hit inside 10 minutes', () => {
      for (let hit = 0; hit < 50; hit += 1) issuer.reportDailyLimit();
      jest.setSystemTime(new Date('2026-10-16T12:09:59.000Z'));
      issuer.reportDailyLimit();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('logs again once 10 minutes have passed, with the count it held back', () => {
      issuer.reportDailyLimit();
      issuer.reportDailyLimit();
      issuer.reportDailyLimit();
      jest.setSystemTime(new Date('2026-10-16T12:10:00.000Z'));
      issuer.reportDailyLimit();

      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenLastCalledWith({ suppressed: 2 }, 'SMS daily limit reached');
    });
  });
});

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { AuthConstants, AuthTokens } from '../auth.constants';
import { generateCode, hashCredential } from '../credentials/emailed-credential';
import { SmsGateway } from '../ports/sms-gateway.port';
import { PhoneLimits } from './phone-send-limits';

/** A fresh code, its stored hash and its deadline. */
export interface MintedPhoneCode {
  readonly code: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
}

/** Placeholder in `AuthConstants.PhoneCodeSmsTemplate`. */
const CODE_PLACEHOLDER = '{code}';

/** Mints phone codes and texts them; shared by phone verification and phone sign-in. */
@Injectable()
export class PhoneCodeIssuer {
  /** When the daily-limit alert last logged; 0 until the first hit. Per instance. */
  private lastLimitLogAt = 0;
  /** Hits since that log that were not logged. */
  private suppressedLimitLogs = 0;

  constructor(
    @Inject(AuthTokens.SmsGateway) private readonly gateway: SmsGateway,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(PhoneCodeIssuer.name) private readonly logger: PinoLogger,
  ) {}

  /** The three send limits as currently configured. */
  limits(): PhoneLimits {
    return {
      cooldownSeconds: this.config.get('PHONE_CODE_RESEND_COOLDOWN_SECONDS', { infer: true }),
      perNumberDaily: this.config.get('PHONE_CODE_DAILY_LIMIT_PER_NUMBER', { infer: true }),
      globalDaily: this.config.get('SMS_DAILY_LIMIT', { infer: true }),
    };
  }

  /** Verification codes one account may request per rolling 24 hours, to any numbers. */
  accountDailyLimit(): number {
    return this.config.get('PHONE_CODE_DAILY_LIMIT_PER_ACCOUNT', { infer: true });
  }

  mint(): MintedPhoneCode {
    const code = generateCode(AuthConstants.PhoneCodeDigits);
    return {
      code,
      codeHash: hashCredential(code),
      expiresAt: new Date(
        Date.now() + AuthConstants.PhoneCodeTtlSeconds * AuthConstants.MillisecondsPerSecond,
      ),
    };
  }

  /**
   * Logs 'SMS daily limit reached' at error so it can alert, at most once per
   * `AuthConstants.SmsDailyLimitLogIntervalMs`. Once the limit is spent every public sign-in
   * request hits it, and an error log per request would let anyone flood the alert channel. The
   * next log carries how many hits it held back.
   */
  reportDailyLimit(): void {
    const now = Date.now();
    if (
      this.lastLimitLogAt !== 0 &&
      now - this.lastLimitLogAt < AuthConstants.SmsDailyLimitLogIntervalMs
    ) {
      this.suppressedLimitLogs += 1;
      return;
    }
    this.logger.error({ suppressed: this.suppressedLimitLogs }, 'SMS daily limit reached');
    this.lastLimitLogAt = now;
    this.suppressedLimitLogs = 0;
  }

  /** `true` when the gateway accepted the text. Never throws and never logs the code. */
  async send(phone: string, code: string): Promise<boolean> {
    try {
      const body = AuthConstants.PhoneCodeSmsTemplate.split(CODE_PLACEHOLDER).join(code);
      return await this.gateway.send({ to: phone, body });
    } catch (error) {
      this.logger.error(
        { err: error, to: phone.slice(-3) },
        'Exception occurred in PhoneCodeIssuer.send',
      );
      return false;
    }
  }
}

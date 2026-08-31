import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { SmsGateway, SmsMessage } from '../ports/sms-gateway.port';
import { NoopSmsGateway } from './noop-sms.gateway';

/**
 * Reports every send as failed, loudly.
 *
 * Returned when `SMS_PROVIDER` names a gateway this build has no adapter for. Reporting
 * success would be worse than useless: OTPs and order updates would silently vanish while the
 * logs claimed delivery. Failing means the notification is recorded FAILED and the retry sweep
 * keeps surfacing it until someone looks.
 */
class UnavailableSmsGateway implements SmsGateway {
  constructor(
    private readonly provider: string,
    private readonly logger: PinoLogger,
  ) {}

  send(message: SmsMessage): Promise<boolean> {
    this.logger.error(
      { provider: this.provider, to: message.to },
      'SMS_PROVIDER names a gateway this build has no adapter for; message not sent',
    );
    return Promise.resolve(false);
  }
}

/**
 * Chooses the SMS adapter from `SMS_PROVIDER`.
 *
 * The variable used to be declared and never read — both modules bound the noop adapter
 * unconditionally, so setting `SMS_PROVIDER=alpha-sms` did nothing at all and did it silently.
 */
export const createSmsGateway = (config: AppConfigService, logger: PinoLogger): SmsGateway => {
  const provider = config.get('SMS_PROVIDER', { infer: true });

  if (provider === 'noop') {
    return new NoopSmsGateway(logger);
  }

  // alpha-sms and ssl-wireless are in the enum as the documented roadmap; neither has an
  // adapter yet. Fail honestly rather than quietly behaving like noop.
  return new UnavailableSmsGateway(provider, logger);
};

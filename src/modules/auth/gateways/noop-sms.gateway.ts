import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { SmsGateway, SmsMessage } from '../ports/sms-gateway.port';

/** Last digits of a number kept in logs outside development. */
const LOGGED_DIGITS = 3;

/**
 * Development stand-in: logs the recipient and reports success without sending
 * anything. Active while `SMS_PROVIDER=noop`, which is the default so nobody
 * spends SMS credits running tests.
 *
 * The message body is logged only when `NODE_ENV=development`, at debug, so a developer can
 * read a sign-in code without a gateway. Everywhere else only its length is logged — an OTP in
 * a log file is a credential in a log file.
 *
 * A plain class, like `AlphaSmsGateway`: `createSmsGateway` builds it with `new` and hands it
 * its logger. It is deliberately not `@Injectable()` — `AppConfigService` is a type alias with
 * no runtime token, so listing this in `providers` must not look like it would work.
 */
export class NoopSmsGateway implements SmsGateway {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {}

  // Not declared `async`: there is nothing to await here, and a real gateway
  // adapter will await its HTTP call while satisfying the same signature.
  send(message: SmsMessage): Promise<boolean> {
    try {
      if (this.config.get('NODE_ENV', { infer: true }) === 'development') {
        this.logger.debug(
          { to: message.to, body: message.body },
          'SMS suppressed: SMS_PROVIDER is noop',
        );
      } else {
        this.logger.info(
          { to: message.to.slice(-LOGGED_DIGITS), bodyLength: message.body.length },
          'SMS suppressed: SMS_PROVIDER is noop',
        );
      }
      return Promise.resolve(true);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in NoopSmsGateway.send');
      return Promise.resolve(false);
    }
  }
}

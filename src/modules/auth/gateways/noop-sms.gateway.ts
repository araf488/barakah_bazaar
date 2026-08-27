import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SmsGateway, SmsMessage } from '../ports/sms-gateway.port';

/**
 * Development stand-in: logs the recipient and reports success without sending
 * anything. Active while `SMS_PROVIDER=noop`, which is the default so nobody
 * spends SMS credits running tests.
 *
 * The message body is never logged — an OTP in a log file is a credential in a
 * log file.
 */
@Injectable()
export class NoopSmsGateway implements SmsGateway {
  constructor(@InjectPinoLogger(NoopSmsGateway.name) private readonly logger: PinoLogger) {}

  // Not declared `async`: there is nothing to await here, and a real gateway
  // adapter will await its HTTP call while satisfying the same signature.
  send(message: SmsMessage): Promise<boolean> {
    try {
      this.logger.info(
        { to: message.to, bodyLength: message.body.length },
        'SMS suppressed: SMS_PROVIDER is noop',
      );
      return Promise.resolve(true);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in NoopSmsGateway.send');
      return Promise.resolve(false);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EmailMessage, EmailSender } from '../ports/email-sender.port';

/**
 * Development stand-in: logs the recipient and reports success without sending.
 *
 * Active while `EMAIL_PROVIDER=noop`, which is the default so a fresh clone boots with no
 * mail account. It reports success for the same reason the SMS noop does — an undelivered
 * message is recoverable and visible in the log, unlike a payment, which fails closed.
 *
 * The body is never logged. A staff invitation body carries a bearer token that grants a
 * permission, and a token in a log file is a credential in a log file. When the provider is
 * noop the raw token is surfaced through the API response instead, so a developer can still
 * complete the flow — see StaffInvitationService.
 */
@Injectable()
export class NoopEmailSender implements EmailSender {
  constructor(@InjectPinoLogger(NoopEmailSender.name) private readonly logger: PinoLogger) {}

  send(message: EmailMessage): Promise<boolean> {
    try {
      this.logger.info(
        { to: message.to, subject: message.subject },
        'Email suppressed: EMAIL_PROVIDER is noop',
      );
      return Promise.resolve(true);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in NoopEmailSender.send');
      return Promise.resolve(false);
    }
  }
}

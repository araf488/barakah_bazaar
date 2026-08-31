import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { EmailMessage, EmailSender } from '../ports/email-sender.port';
import { NoopEmailSender } from './noop-email.sender';

/**
 * Reports every send as failed, loudly.
 *
 * Returned when `EMAIL_PROVIDER` names a provider this build has no adapter for. A staff
 * invitation that reported success but never arrived would leave the invitee waiting on an
 * email nobody sent, and the operator with no reason to look.
 */
class UnavailableEmailSender implements EmailSender {
  constructor(
    private readonly provider: string,
    private readonly logger: PinoLogger,
  ) {}

  send(message: EmailMessage): Promise<boolean> {
    // Subject only. The body of an invitation carries a bearer token.
    this.logger.error(
      { provider: this.provider, to: message.to, subject: message.subject },
      'EMAIL_PROVIDER names a provider this build has no adapter for; message not sent',
    );
    return Promise.resolve(false);
  }
}

/** Chooses the email adapter from `EMAIL_PROVIDER`. */
export const createEmailSender = (config: AppConfigService, logger: PinoLogger): EmailSender => {
  const provider = config.get('EMAIL_PROVIDER', { infer: true });

  if (provider === 'noop') {
    return new NoopEmailSender(logger);
  }

  // resend and smtp are the documented roadmap; neither has an adapter yet.
  return new UnavailableEmailSender(provider, logger);
};

import { Injectable } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { EmailMessage, EmailSender } from '../ports/email-sender.port';

/**
 * SMTP adapter, active while `EMAIL_PROVIDER=smtp`.
 *
 * The provider is configuration, not code: the same adapter talks to Mailpit on
 * `localhost:1025` and to Brevo on `smtp-relay.brevo.com:587`. That is the whole reason the
 * design chose SMTP over a vendor HTTP client — swapping provider is an env change, and a
 * developer can read every message in Mailpit's web UI without an account anywhere.
 *
 * Reports failure rather than throwing, like every other sender behind this port: an
 * undelivered message is recoverable and visible in the log.
 */
@Injectable()
export class SmtpEmailSender implements EmailSender {
  /** Built once. A transport per message would open a TCP connection per message. */
  private transport: Transporter | null = null;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(SmtpEmailSender.name) private readonly logger: PinoLogger,
  ) {}

  async send(message: EmailMessage): Promise<boolean> {
    try {
      const payload: Record<string, unknown> = {
        from: this.from(),
        to: message.to,
        subject: message.subject,
        text: message.body,
      };

      // Assigned only when present: an empty html part makes some clients render a blank
      // message in place of the text one.
      if (message.html !== undefined) {
        payload.html = message.html;
      }

      await this.transporter().sendMail(payload);
      return true;
    } catch (error) {
      // Recipient and subject only. The body carries the verification credential.
      this.logger.error(
        { err: error, to: message.to, subject: message.subject },
        'Exception occurred in SmtpEmailSender.send',
      );
      return false;
    }
  }

  private transporter(): Transporter {
    this.transport ??= createTransport({
      host: this.config.get('EMAIL_SMTP_HOST', { infer: true }),
      port: this.config.get('EMAIL_SMTP_PORT', { infer: true }),
      secure: this.config.get('EMAIL_SMTP_SECURE', { infer: true }),
      auth: {
        user: this.config.get('EMAIL_SMTP_USER', { infer: true }),
        pass: this.config.get('EMAIL_SMTP_PASSWORD', { infer: true }),
      },
    });

    return this.transport;
  }

  /** `"Name" <address>`, because a relay shows the bare address without the display name. */
  private from(): string {
    const address = this.config.get('EMAIL_FROM', { infer: true });
    const name = this.config.get('EMAIL_FROM_NAME', { infer: true });
    return `"${name}" <${address}>`;
  }
}

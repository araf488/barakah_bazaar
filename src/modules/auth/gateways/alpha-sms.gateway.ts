import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { AlphaSmsApi, AuthConstants } from '../auth.constants';
import { SmsGateway, SmsMessage } from '../ports/sms-gateway.port';

/** Last digits of a number kept in logs; enough to find a send, not enough to identify a person. */
const LOGGED_DIGITS = 3;

/**
 * Alpha SMS (sms.net.bd) adapter, selected by `SMS_PROVIDER=alpha-sms`.
 *
 * Request and response shape follow https://www.alpha.net.bd/SMS/API. Never throws: every fault
 * becomes `false` so the caller can answer "text messages are unavailable" instead of a 500.
 * Logs carry the last 3 digits of the recipient and never the body, which holds a sign-in code.
 */
export class AlphaSmsGateway implements SmsGateway {
  constructor(
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {}

  async send(message: SmsMessage): Promise<boolean> {
    const to = message.to.slice(-LOGGED_DIGITS);
    try {
      const url = this.config.get('SMS_API_URL', { infer: true });
      const apiKey = this.config.get('SMS_API_KEY', { infer: true });
      if (!url || !apiKey) {
        this.logger.error({ to }, 'Alpha SMS is not configured; message not sent');
        return false;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': AlphaSmsApi.ContentType },
        body: this.buildForm(message, apiKey).toString(),
        signal: AbortSignal.timeout(AuthConstants.SmsRequestTimeoutMs),
      });

      if (!response.ok) {
        this.logger.error({ to, status: response.status }, 'Alpha SMS answered a non-2xx status');
        return false;
      }

      const result = (await response.json()) as { error?: unknown };
      if (Number(result.error) !== AlphaSmsApi.SuccessErrorCode) {
        // Coerced: the field comes from a remote body, so only a number ever reaches the log.
        this.logger.error(
          { to, errorCode: Number(result.error) },
          'Alpha SMS rejected the message',
        );
        return false;
      }
      return true;
    } catch (error) {
      // The error is logged by name only: a fetch error message can echo the request URL or body.
      this.logger.error(
        { to, errorName: error instanceof Error ? error.name : typeof error },
        'Exception occurred in AlphaSmsGateway.send',
      );
      return false;
    }
  }

  private buildForm(message: SmsMessage, apiKey: string): URLSearchParams {
    const form = new URLSearchParams({
      [AlphaSmsApi.ApiKeyField]: apiKey,
      [AlphaSmsApi.MessageField]: message.body,
      [AlphaSmsApi.RecipientField]: message.to.replace(AlphaSmsApi.PlusPrefix, ''),
    });
    const senderId = message.senderId ?? this.config.get('SMS_SENDER_ID', { infer: true });
    if (senderId) {
      form.set(AlphaSmsApi.SenderIdField, senderId);
    }
    return form;
  }
}

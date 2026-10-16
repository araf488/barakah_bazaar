import { SmsGateway, SmsMessage } from '../../src/modules/auth/ports/sms-gateway.port';

/** An SMS captured by `RecordingSmsGateway`. */
export interface CapturedSms {
  to: string;
  body: string;
}

/**
 * Stand-in for the SMS gateway in the e2e suites. Bound with
 * `overrideProvider(AuthTokens.SmsGateway)` so a journey can read the code a real handset would
 * receive: no endpoint ever returns a code, in any SMS_PROVIDER mode.
 */
export class RecordingSmsGateway implements SmsGateway {
  readonly sent: CapturedSms[] = [];

  send(message: SmsMessage): Promise<boolean> {
    this.sent.push({ to: message.to, body: message.body });
    return Promise.resolve(true);
  }

  /** Clears everything captured so far. Call between tests. */
  reset(): void {
    this.sent.length = 0;
  }

  /** The most recently captured message to this number. Throws if there was none. */
  latestTo(phone: string): CapturedSms {
    const match = [...this.sent].reverse().find((sent) => sent.to === phone);

    if (!match) {
      throw new Error(`No SMS was captured for ${phone}`);
    }

    return match;
  }
}

/** How long `waitForSmsTo` waits for a message before failing the test. */
export const SMS_WAIT_TIMEOUT_MS = 5_000;

/** How often `waitForSmsTo` looks again. */
export const SMS_POLL_INTERVAL_MS = 10;

/** Digits in a phone code, as it appears in the SMS body. */
const CODE_PATTERN = /\b(\d{6})\b/;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts captured messages to a number. */
export const countSmsTo = (gateway: RecordingSmsGateway, phone: string): number =>
  gateway.sent.filter((sent) => sent.to === phone).length;

/**
 * Waits for a message to this number beyond the first `alreadySeen`, and returns the newest.
 * Pass the count from before the request, so an earlier message cannot satisfy it.
 */
export const waitForSmsTo = async (
  gateway: RecordingSmsGateway,
  phone: string,
  alreadySeen = 0,
  timeoutMs = SMS_WAIT_TIMEOUT_MS,
): Promise<CapturedSms> => {
  const deadline = Date.now() + timeoutMs;

  while (countSmsTo(gateway, phone) <= alreadySeen) {
    if (Date.now() > deadline) {
      throw new Error(`No new SMS reached ${phone} within ${timeoutMs} ms`);
    }
    await sleep(SMS_POLL_INTERVAL_MS);
  }

  return gateway.latestTo(phone);
};

/** Pulls the 6-digit code out of an SMS body, the way a person reads it off their handset. */
export const codeFrom = (body: string): string => {
  const match = CODE_PATTERN.exec(body);

  if (!match) {
    throw new Error('No 6-digit code found in the SMS body');
  }

  return match[1];
};

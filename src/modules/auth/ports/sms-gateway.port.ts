/** A single outbound SMS. */
export interface SmsMessage {
  /** E.164 Bangladesh number, e.g. +8801XXXXXXXXX. */
  readonly to: string;
  readonly body: string;
  /** Optional override of the configured sender/mask id. */
  readonly senderId?: string;
}

/**
 * Outbound SMS port.
 *
 * Supabase Auth's built-in phone provider only supports Twilio, MessageBird,
 * Vonage and TextLocal — none of the local Bangladesh gateways. Phone OTP is
 * therefore a custom flow in this API (plan §4.1, Option A), and this port is
 * the seam an Alpha SMS or SSL Wireless adapter drops into without touching
 * any calling code.
 */
export interface SmsGateway {
  /** Returns true when the gateway accepted the message for delivery. */
  send(message: SmsMessage): Promise<boolean>;
}

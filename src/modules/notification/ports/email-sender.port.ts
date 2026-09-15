/** A single outbound email. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text. Always present — some clients render nothing else, and a spam filter reads it. */
  readonly body: string;
  /**
   * Optional HTML alternative, sent as a multipart alternative beside `body`. Optional so the
   * staff-invitation caller, which has only text, is unchanged.
   */
  readonly html?: string;
}

/**
 * Outbound email port.
 *
 * Separate from `SmsGateway` rather than a channel on it: the two have different providers,
 * different failure modes and different costs, and a combined interface would force every
 * adapter to implement a channel it cannot send.
 *
 * Supabase Auth can send its own invitation emails, but that path is deliberately not used
 * here — it would put the invitation's expiry, wording and audit trail inside the identity
 * provider, where this API cannot revoke or record them.
 */
export interface EmailSender {
  /** Returns true when the provider accepted the message for delivery. */
  send(message: EmailMessage): Promise<boolean>;
}

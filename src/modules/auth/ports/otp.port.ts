/** Outcome of issuing an OTP challenge. */
export interface OtpChallenge {
  readonly phone: string;
  readonly expiresAt: Date;
  readonly attemptsRemaining: number;
}

/**
 * Phone-OTP port for the custom login flow described in the plan (§4.1).
 *
 * Declared now so the Auth module's shape is settled, but deliberately left
 * **unimplemented and unregistered** until Phase 1: the implementation needs a
 * chosen local SMS gateway plus Redis-backed challenge storage, and guessing
 * either would be wasted work. Injecting AuthTokens.OtpService before then
 * fails loudly at startup rather than silently no-op'ing.
 */
export interface OtpService {
  /** Generates, stores and sends a challenge for the given phone number. */
  issue(phone: string): Promise<OtpChallenge>;

  /** Consumes a challenge. True only for a correct, unexpired code. */
  verify(phone: string, code: string): Promise<boolean>;
}

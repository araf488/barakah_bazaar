/** Auth-module constants. Cross-cutting values live in app.constants.ts. */
export const AuthConstants = {
  /** Digits in a phone-login OTP. */
  OtpLength: 6,
  /** How long an issued OTP stays valid. */
  OtpTtlSeconds: 300,
  /** Maximum verification attempts before an OTP is burned. */
  OtpMaxAttempts: 5,
  /**
   * Supabase `app_metadata` key carrying the staff role. Written by the admin
   * module through the Supabase Admin API; mirrored into `users.role`.
   */
  RoleClaimKey: 'role',
} as const;

/** Injection tokens for the auth ports. */
export const AuthTokens = {
  SmsGateway: Symbol('BARAKAH_SMS_GATEWAY'),
  OtpService: Symbol('BARAKAH_OTP_SERVICE'),
} as const;

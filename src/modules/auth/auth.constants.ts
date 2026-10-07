/** Auth-module constants. Cross-cutting values live in app.constants.ts. */
export const AuthConstants = {
  /** Digits in a phone-login OTP. */
  OtpLength: 6,
  /** How long an issued OTP stays valid. */
  OtpTtlSeconds: 300,
  /** Maximum verification attempts before an OTP is burned. */
  OtpMaxAttempts: 5,
  /** Resource label used in not-found messages about the local user row. */
  UserResourceName: 'User',
  /** Stored-hash format: scrypt$N$r$p$salt$hash. */
  PasswordHashAlgorithm: 'scrypt',
  PasswordHashSeparator: '$',
  PasswordHashPartCount: 6,
  PasswordSaltBytes: 16,
  PasswordKeyBytes: 32,
  /** scrypt needs 128 * N * r bytes; Node's 32 MiB default maxmem throws above it. */
  ScryptMaxMemFactor: 128,
  /**
   * Node's internal scrypt buffers need a bit more than the textbook 128*N*r bytes (measured
   * ~72 KiB extra at r=32,p=16, independent of N); without this margin `maxmem` set to exactly
   * 128*N*r throws "memory limit exceeded" on every call, including at the schema's defaults.
   */
  ScryptMaxMemSafetyBytes: 1_048_576,
  /** Filename of the bundled weak-password denylist, resolved relative to this module. */
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a filename, not a credential
  CommonPasswordsFileName: 'common-passwords.txt',
  PasswordMinLength: 12,
  PasswordMaxLength: 128,
  /** Ceiling on a submitted full name. Unbounded text on an unauthenticated route is a cheap
   *  way to write megabytes into a row and into every log line that ever names it. */
  FullNameMaxLength: 120,
  PasswordMinDistinctCharacters: 6,
  PasswordMaxSequentialRun: 6,
  /** Below this, a name fragment matches too much to be meaningful. */
  PasswordIdentityMinLength: 4,
  /**
   * What counts as a "special character" for the composition rule.
   *
   * The printable ASCII punctuation and symbols, i.e. everything that is neither a letter nor
   * a digit nor whitespace. **Space is deliberately excluded**: a passphrase is mostly spaces,
   * and letting one satisfy the rule would mean `correct horse battery staple` passed a check
   * that exists precisely to demand a symbol. Space remains perfectly legal *in* a password —
   * it simply does not count toward this requirement.
   */
  PasswordSpecialCharacters: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' as string,
  PasswordBannedWords: ['barakah', 'bazaar'] as readonly string[],
  /**
   * Status value `POST /auth/register` and `POST /auth/resend-verification` answer with.
   * Identical in every case — see `RegistrationAcceptedDto`.
   */
  RegistrationPendingStatus: 'pending_verification',
  /** Link-token entropy, in bytes, before base64url encoding. Matches the refresh token. */
  EmailVerificationTokenBytes: 32,
  /**
   * Ceiling on the submitted `token` field of `POST /auth/verify-email`. 32 random bytes
   * base64url-encodes to 43 characters; this leaves a comfortable margin above that while still
   * bounding an unauthenticated, unbounded string before it is hashed and searched — otherwise
   * a caller could hand this `@Public()` route an arbitrarily large value to hash on every call.
   */
  EmailVerificationTokenMaxLength: 128,
  /** Digits in the emailed verification code. */
  EmailVerificationCodeDigits: 6,
  /**
   * Wrong codes tolerated against one verification record before it is dead. Six digits is a
   * million guesses; without a cap the code is not a credential. The link token has no cap and
   * needs none — 32 random bytes is not guessable, and capping it would let anyone kill a
   * stranger's verification by hammering the endpoint.
   */
  EmailVerificationMaxAttempts: 5,
  /**
   * How long before a resend is honoured again. Guards the 300-a-day sending quota: an endpoint
   * that mails an attacker-chosen address is otherwise a cheap denial of service against the
   * whole system's ability to send anything.
   */
  EmailVerificationResendCooldownSeconds: 60,
  /** How long a consumed or expired verification is kept before the sweeper removes it. */
  EmailVerificationRetentionDays: 30,
  /**
   * Status value `POST /auth/forgot-password` answers with. Identical in every non-error case —
   * known address, unknown address, cooldown, disabled account — or the response becomes an
   * oracle for which addresses have accounts.
   */
  PasswordResetRequestedStatus: 'reset_requested',
  /** Link-token entropy, in bytes, before base64url encoding. Matches the verification token. */
  PasswordResetTokenBytes: 32,
  /**
   * Ceiling on the submitted `token` of `POST /auth/reset-password`. Same reasoning as
   * `EmailVerificationTokenMaxLength`: 43 characters is real, 128 bounds an unauthenticated
   * string before it is hashed.
   */
  PasswordResetTokenMaxLength: 128,
  /** Digits in the emailed reset code. */
  PasswordResetCodeDigits: 6,
  /**
   * Wrong codes tolerated against one reset record before it is dead. The link token has no
   * cap: 32 random bytes is not guessable, and a cap would let anyone kill a stranger's reset.
   */
  PasswordResetMaxAttempts: 5,
  /**
   * How long after one reset email another is honoured. Guards the 300-a-day sending quota
   * against an endpoint that mails an attacker-chosen address.
   */
  PasswordResetRequestCooldownSeconds: 60,
  /** How long a consumed or expired reset is kept before the sweeper removes it. */
  PasswordResetRetentionDays: 30,
  /** Path on `APP_PUBLIC_BASE_URL` the reset link opens. Never built from the request. */
  PasswordResetLinkPath: '/reset-password',
  /** AES-256-GCM: the algorithm TOTP secrets are sealed with at rest. */
  CipherAlgorithm: 'aes-256-gcm',
  CipherIvBytes: 12,
  /** AES-256 key size. Anything a configured TOTP_ENCRYPTION_KEY decodes to besides this is a misconfiguration. */
  CipherKeyBytes: 32,
  CipherSeparator: '.',
  CipherPartCount: 3,
  /** Issuer name shown in an authenticator app next to the account label. */
  TotpIssuer: 'Barakah Bazaar',
  TotpAlgorithm: 'sha1',
  TotpDigits: 6,
  TotpStepSeconds: 30,
  /** Steps of clock drift tolerated either side of now. */
  TotpDriftSteps: 1,
  /** 20 bytes is the RFC 6238 recommendation and encodes to 32 base32 characters. */
  TotpSecretBytes: 20,
  TotpMaxFailedAttempts: 5,
  /**
   * How long a run of failed codes stays counted. Without it the counter only ever resets on
   * a *successful* verification, so five fumbles spread across months would lock an account
   * that was never under attack — the count has to mean "five recently", not "five ever".
   */
  TotpFailureWindowMinutes: 60,
  TotpLockoutMinutes: 15,
  TotpRecoveryCodeCount: 10,
  TotpRecoveryCodeBytes: 10,
  /** Prisma primary key of the single, singleton `auth_settings` row. */
  AuthSettingsRowId: 'singleton',
  /** Floor and ceiling for a configurable access-token lifetime, in minutes. */
  AccessTokenMinMinutes: 5,
  AccessTokenMaxMinutes: 120,
  /** HS256: exactly one service both signs and verifies this application's tokens. */
  JwtAlgorithm: 'HS256',
  /** Claim an intermediate token carries its `passwordChangedAt` epoch in (credential stamp). */
  CredentialStampClaim: 'pca',
  /** Seconds of clock drift tolerated either side of `exp`/`iat` on verification. */
  JwtClockToleranceSeconds: 30,
  /** HS256 secret size for the generated fallback signing key, in bytes. */
  JwtSecretBytes: 32,
  /** Header a client sends its device id in. */
  DeviceIdHeader: 'x-device-id',
  DeviceIdMaxLength: 128,
  /**
   * How much of a user agent reaches the anomaly log when it differs from the one a session
   * was issued to (§5.6). Capped because the header is unbounded attacker-controlled input
   * and the column that stores it is untyped text: without a ceiling, one client can write
   * an arbitrarily large string into every log line it provokes. 256 is several times a real
   * user agent, so a genuine one is never cut.
   */
  UserAgentLogMaxLength: 256,
  /** Refresh-token entropy, in bytes, before base64url encoding. */
  RefreshTokenBytes: 32,
  /**
   * Hard ceiling on the refresh-token reuse grace window, enforced where the window is used
   * rather than where it is configured. The stored setting is validated as a non-negative
   * integer but is not bounded above, and the window is the length of time a rotated-away
   * token still works — so one mistyped value would otherwise switch replay detection off
   * for as long as it said. Two minutes is far beyond any plausible request race.
   */
  RefreshReuseGraceMaxSeconds: 120,
  /**
   * How stale `lastUsedAt` must be before an authenticated request writes the sliding idle
   * deadline forward. Without a floor, every request on a busy session becomes a write.
   */
  SessionTouchIntervalMinutes: 5,
  /** How long the intermediate MFA and enrolment tokens live. */
  MfaTokenMinutes: 5,
  /**
   * `sessionId` claim for a token signed before any session exists (the intermediate MFA and
   * enrolment tokens). Empty is honest about there being nothing to name yet, matching the
   * convention `SessionService` already uses for an absent email claim.
   */
  PendingSessionId: '',
  /** Resource label for the 404 on someone else's session. */
  SessionResourceName: 'Session',
  /** IPv4 last octet replacement in a session listing. */
  IpTruncationSuffix: '.0',
  /**
   * How many of an IPv6 address's eight 16-bit groups survive truncation in a session
   * listing. Four groups is a /64 — the conventional privacy boundary, since a /64 is
   * typically one subscriber's line (RFC 4291 §2.5.4) — rather than a /112, which dropping a
   * single trailing group would give and which still identifies one host.
   */
  Ipv6TruncationPrefixGroups: 4,
  /**
   * How often `SessionSweeper` deletes sessions past their hard ceiling and the recovery
   * codes of disabled accounts. Hourly, not by the minute: nothing here is urgent — an
   * expired session is already refused by the guard, and this only reclaims the row — so a
   * tighter interval would buy nothing and cost a query on every instance.
   */
  SweepIntervalMinutes: 60,
  /** Unit conversions for the token and session deadlines, all of which are configured in minutes. */
  MillisecondsPerMinute: 60_000,
  MillisecondsPerSecond: 1_000,
  /**
   * Hard ceiling on how long a cached session validation may live in Redis, regardless of how
   * far away the session's own `absoluteExpiresAt` is. Kept equal to
   * `SessionTouchIntervalMinutes`: a cache hit skips the sliding idle-deadline write (it has no
   * `lastUsedAt` to throttle against), so this ceiling is also what bounds how long that write
   * can be deferred for a session served entirely from cache — never longer than the interval
   * the write is already throttled to.
   */
  SessionCacheTtlCeilingSeconds: 300,
} as const;

/** Injection tokens for the auth ports. */
export const AuthTokens = {
  SmsGateway: Symbol('BARAKAH_SMS_GATEWAY'),
  OtpService: Symbol('BARAKAH_OTP_SERVICE'),
  SessionCache: Symbol('BARAKAH_SESSION_CACHE'),
  /**
   * The auth module's own binding, deliberately separate from `AdminTokens.EmailSender`: the
   * two modules send different mail for different reasons, and sharing a token would make the
   * auth module depend on the admin module's DI wiring.
   */
  EmailSender: Symbol('BARAKAH_AUTH_EMAIL_SENDER'),
} as const;

/** User-facing auth messages. Changing one of these is an API change. */
export const AuthMessages = {
  /** The password is shorter than the 12-character minimum. */
  PasswordTooShort: 'Your password must be at least 12 characters.',
  /** The password is longer than the 128-character maximum. */
  PasswordTooLong: 'Your password must be 128 characters or fewer.',
  /** The password appears on the bundled list of common passwords. */
  PasswordTooCommon: 'That password is too common. Please choose a different one.',
  /** The password contains the account's own email local-part or full name. */
  PasswordContainsIdentity: 'Your password must not contain your name or email address.',
  /** The password contains "barakah" or "bazaar". */
  PasswordContainsShopName: 'Your password must not contain the name of this shop.',
  /** Fewer than six distinct characters. */
  PasswordTooFewDistinct: 'Your password must use at least 6 different characters.',
  /** Six or more sequential characters, ascending or descending. */
  PasswordSequential: 'Your password must not contain a long run of sequential characters.',
  /**
   * The password is missing one or more of the four required character classes.
   *
   * One message naming all four rather than four messages revealing one rule at a time: a
   * caller fixing a password should see the whole requirement at once, not discover it over
   * four submissions.
   */
  PasswordMissingCharacterClasses:
    'Your password must include an uppercase letter, a lowercase letter, a number and a special character.',
  /**
   * Unknown, expired, already-used or simply wrong verification credential. One message for all
   * four: distinguishing them tells whoever holds a credential exactly what they hold.
   */
  VerificationInvalid: 'That verification link or code is not valid. Please request a new one.',
  /** The attempt cap was reached against one verification record. */
  VerificationTooManyAttempts: 'Too many incorrect codes. Please request a new verification email.',
  /**
   * Unknown, expired, already-used or simply wrong reset credential. One message for all four:
   * distinguishing them tells whoever holds a credential exactly what they hold.
   */
  ResetInvalid: 'That password reset link or code is not valid. Please request a new one.',
  /** The attempt cap was reached against one reset record. */
  ResetTooManyAttempts: 'Too many incorrect codes. Please request a new password reset email.',
  /** Wrong password, unknown address, or an unusable refresh token. Deliberately one message. */
  InvalidCredentials: 'Those sign-in details are not correct.',
  /** The account exists and the password was right, but the email is not verified. */
  EmailNotVerified: 'Please verify your email address before signing in.',
  /** Login or refresh arrived without the X-Device-Id header. */
  DeviceIdRequired: 'This client must identify its device.',
  /** A second factor is needed to finish signing in. */
  MfaRequired: 'Enter the code from your authenticator app.',
  /** Too many wrong codes. */
  MfaLocked: 'Too many incorrect codes. Try again in 15 minutes.',
  /** The TOTP code or recovery code presented does not verify. */
  InvalidMfaCode: 'That code is not valid.',
  /** Enabling MFA was requested before `setup` produced a secret to confirm. */
  MfaSetupRequired: 'Set up two-factor authentication before enabling it.',
  /** A staff account tried to turn MFA off while `staffMfaRequired` is set. */
  MfaCannotBeDisabledForStaff:
    'Two-factor authentication is required for staff accounts and cannot be disabled.',
} as const;

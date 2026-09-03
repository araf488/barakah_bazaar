import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../../common/types/service-response';
import { User, UserRole } from '../../../infra/prisma/prisma-client';
import { AuthConstants, AuthMessages } from '../auth.constants';
import { ResolvedAuthSettings, AuthSettingsService } from '../settings/auth-settings.service';
import { AccessTokenClaims, AccessTokenService } from '../tokens/access-token.service';
import { SessionRepository, SessionSighting, SessionWithUser } from './session.repository';

/** A signed-in device's credentials. The refresh token is raw here and nowhere else. */
export interface IssuedSession {
  readonly accessToken: string;
  /** When the access token stops verifying. */
  readonly expiresAt: Date;
  readonly refreshToken: string;
  /** The session's sliding idle deadline, which is what the refresh token is good until. */
  readonly refreshExpiresAt: Date;
  readonly user: User;
}

/** What the guard learns from a session that is still allowed to act. */
export interface ValidatedSession {
  readonly user: User;
  readonly sessionId: string;
}

/** The two deadlines a role's refresh policy sets, in minutes. */
interface RefreshWindow {
  readonly idleMinutes: number;
  readonly absoluteMinutes: number;
}

/** A freshly signed access token and the moment it stops verifying. */
interface SignedAccess {
  readonly accessToken: string;
  readonly expiresAt: Date;
}

/**
 * Owns the lifecycle of a signed-in device: issue, validate, rotate, revoke.
 *
 * The refresh token is a random 32 bytes, and only its SHA-256 is stored — a database dump
 * therefore yields no usable session. Rotation is unconditional: every successful refresh
 * invalidates the token that was presented, so a stolen token has a useful life measured in
 * one request rather than in the length of the refresh window.
 *
 * That strictness has a well-known failure mode, and this service is built around it: a
 * client whose requests race (two tabs, a retried mobile request) presents the same token
 * twice, and a naive rotate-or-revoke implementation reads the second one as theft and signs
 * a real user out. `previousRefreshTokenHash` plus `previousRotatedAt` is what tells the two
 * apart — a reuse moments after the rotation is the same client, a reuse later is not.
 *
 * Nothing here logs a raw token, a hash, or anything else that would let a reader of the logs
 * mint a session. `sessionId` is the identifier that goes in a log line.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly tokens: AccessTokenService,
    private readonly settings: AuthSettingsService,
    @InjectPinoLogger(SessionService.name) private readonly logger: PinoLogger,
  ) {}

  /** SHA-256 of the raw token. The raw value is never persisted. */
  static hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('base64url');
  }

  /**
   * Everyone but a customer is staff, so a role added later gets the *shorter* staff windows
   * and strict ip binding by default. The other polarity would silently grant a new role the
   * customer's 30-day session.
   */
  private static isStaff(role: UserRole): boolean {
    return role !== UserRole.CUSTOMER;
  }

  /**
   * Opens a session for a user who has already proved who they are.
   *
   * This method makes no eligibility decision: password, MFA and email verification are the
   * caller's business, and a session that exists here is one that was already earned.
   */
  async issue(
    user: User,
    deviceId: string,
    userAgent: string | null,
    ip: string | null,
  ): Promise<ServiceResponse<IssuedSession>> {
    try {
      const settings = await this.settings.current();
      const window = SessionService.refreshWindow(user.role, settings);
      const issuedAt = Date.now();
      const raw = randomBytes(AuthConstants.RefreshTokenBytes).toString('base64url');

      const session = await this.repository.create({
        userId: user.id,
        refreshTokenHash: SessionService.hashToken(raw),
        expiresAt: SessionService.minutesAfter(issuedAt, window.idleMinutes),
        absoluteExpiresAt: SessionService.minutesAfter(issuedAt, window.absoluteMinutes),
        deviceId,
        userAgent,
        ipAddress: ip,
      });

      if (!session) {
        // No row means no way to revoke or expire whatever we might hand back, so nothing is
        // handed back. A credential the server cannot later kill is worse than a failed login.
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const access = await this.signAccessToken(user, session.id, deviceId, settings);

      return serviceOk({
        accessToken: access.accessToken,
        expiresAt: access.expiresAt,
        refreshToken: raw,
        refreshExpiresAt: session.expiresAt,
        user,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.id },
        'Exception occurred in SessionService.issue',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Stage two of the guard: the token verified on CPU alone, and this decides whether the
   * session behind it may still act.
   *
   * The claims are trustworthy — the signature proved that — but they are also a snapshot
   * taken when the token was signed. Revocation, expiry and a disabled account all happen
   * after signing, and only the row can report them.
   */
  async validate(
    claims: AccessTokenClaims,
    deviceId: string,
    ip: string | null,
  ): Promise<ServiceResponse<ValidatedSession>> {
    try {
      const session = await this.repository.findByIdWithUser(claims.sessionId);

      if (session === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (session === undefined) {
        return serviceFail(HttpStatus.UNAUTHORIZED, ErrorMessages.InvalidAccessToken);
      }

      // The `sub` and `sid` claims are signed together, so they can only disagree if a
      // signing key was shared or a token was hand-assembled. Cheap to check, and the
      // alternative is acting on one user's session as another user.
      if (session.userId !== claims.userId) {
        this.logger.warn(
          { sessionId: session.id },
          'Access token subject does not own the session it names',
        );
        return serviceFail(HttpStatus.UNAUTHORIZED, ErrorMessages.InvalidAccessToken);
      }

      const settings = await this.settings.current();
      const failure = await this.assertUsable(
        session,
        deviceId,
        ip,
        settings,
        ErrorMessages.InvalidAccessToken,
      );

      if (failure) {
        return failure;
      }

      await this.slideIdleDeadline(session, settings);

      return serviceOk({ user: session.user, sessionId: session.id });
    } catch (error) {
      this.logger.error(
        { err: error, sessionId: claims.sessionId },
        'Exception occurred in SessionService.validate',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Trades a refresh token for a new access token, rotating the refresh token as it goes.
   *
   * Every failure that is not a server fault answers with the same 401 and the same message.
   * "That token was already used" would confirm to whoever holds it that they hold a real
   * one, and tell them exactly how recently it worked.
   */
  async refresh(
    rawRefreshToken: string,
    deviceId: string,
    userAgent: string | null,
    ip: string | null,
  ): Promise<ServiceResponse<IssuedSession>> {
    try {
      const presentedHash = SessionService.hashToken(rawRefreshToken);
      const session = await this.repository.findByRefreshHash(presentedHash);

      if (session === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (session === undefined) {
        return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
      }

      const settings = await this.settings.current();
      // Confirmed by a positive match on the previous slot, not inferred from "it is not the
      // current hash". The two are equivalent only while `findByRefreshHash` returns a row
      // solely when the hash matched one of the two columns; if that method ever becomes a
      // `findFirst` with an `OR`, inequality would classify a hash matching *neither* column
      // as a previous-hash reuse and let it into the grace window instead of rejecting it.
      const rotatedAway = session.previousRefreshTokenHash === presentedHash;

      if (rotatedAway && !SessionService.withinReuseGrace(session, settings)) {
        await this.repository.revoke(session.id);
        this.logger.warn(
          { sessionId: session.id },
          'Refresh token replay detected, session revoked',
        );
        return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
      }

      const failure = await this.assertUsable(
        session,
        deviceId,
        ip,
        settings,
        AuthMessages.InvalidCredentials,
      );

      if (failure) {
        return failure;
      }

      if (rotatedAway) {
        // Awaited, not returned bare: an unawaited promise rejects *outside* this method's
        // try/catch, so a signing failure here would escape as an unhandled rejection with no
        // `ServiceResponse` and nothing logged.
        return await this.reissueWithinGrace(session, deviceId, settings, rawRefreshToken);
      }

      return await this.rotateAndIssue(session, deviceId, settings, presentedHash, {
        userAgent,
        ipAddress: ip,
      });
    } catch (error) {
      // No session id in this line: resolving the token is the first thing that happens, and
      // a throw before that leaves nothing safe to name. The token itself is never logged.
      this.logger.error({ err: error }, 'Exception occurred in SessionService.refresh');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Ends one session. Idempotent: revoking an already-revoked session is a success. */
  async revoke(sessionId: string): Promise<ServiceResponse<void>> {
    try {
      const revoked = await this.repository.revoke(sessionId);

      if (!revoked) {
        // `false` is only ever a failed write, so the session may still be live. Reporting
        // success here would tell a user their stolen device had been signed out when it
        // had not.
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error({ err: error, sessionId }, 'Exception occurred in SessionService.revoke');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Ends every live session a user has, and reports how many were still live.
   *
   * A password change and a lockout both depend on this actually happening, so a failed write
   * is a failure here rather than a cheerful zero.
   */
  async revokeAll(userId: string): Promise<ServiceResponse<number>> {
    try {
      const revoked = await this.repository.revokeAllForUser(userId);

      if (revoked === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      this.logger.info({ userId, revoked }, 'Revoked every live session for a user');

      return serviceOk(revoked);
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Exception occurred in SessionService.revokeAll');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Shared guards ─────────────────────────────────────────────────────────

  /**
   * Everything that can disqualify a session found by either path, in the order that answers
   * with the least information: lifecycle first, then the device, then the account.
   *
   * `unauthorizedMessage` is a parameter because the guard and the refresh endpoint speak
   * different vocabularies — "sign in again" versus "those details are not correct" — and a
   * refresh that leaked the guard's wording would tell a caller which of the two paths it had
   * reached. Returns the failure, or `null` when the session may act.
   */
  private async assertUsable(
    session: SessionWithUser,
    deviceId: string,
    ip: string | null,
    settings: ResolvedAuthSettings,
    unauthorizedMessage: string,
  ): Promise<ServiceResponse<never> | null> {
    if (session.revokedAt !== null) {
      return serviceFail(HttpStatus.UNAUTHORIZED, unauthorizedMessage);
    }

    const now = Date.now();

    // Checked separately from the idle deadline, and first, because this is the one no
    // rotation can move: a session whose idle window was slid forward a second ago is still
    // finished once its ceiling passes.
    if (session.absoluteExpiresAt.getTime() <= now) {
      return serviceFail(HttpStatus.UNAUTHORIZED, unauthorizedMessage);
    }

    if (session.expiresAt.getTime() <= now) {
      return serviceFail(HttpStatus.UNAUTHORIZED, unauthorizedMessage);
    }

    if (session.deviceId !== deviceId) {
      // The token verified against *this* device's binding, yet the row belongs to another
      // device — so a token minted for one client is being presented by a different one.
      // Nothing legitimate does that, which makes refusing the request too small a response.
      await this.repository.revoke(session.id);
      this.logger.warn({ sessionId: session.id }, 'Session device mismatch, session revoked');
      return serviceFail(HttpStatus.UNAUTHORIZED, unauthorizedMessage);
    }

    if (!session.user.isActive) {
      // 403, not 401: the credential is genuine and re-authenticating will not help. A 401
      // would send the client into a sign-in loop it can never win.
      this.logger.warn({ sessionId: session.id }, 'Disabled account presented a live session');
      return serviceFail(HttpStatus.FORBIDDEN, ErrorMessages.AccountDisabled);
    }

    if (SessionService.ipRejected(session, ip, settings)) {
      this.logger.warn(
        { sessionId: session.id },
        'Session ip address changed while strict binding is on',
      );
      return serviceFail(HttpStatus.UNAUTHORIZED, unauthorizedMessage);
    }

    return null;
  }

  /**
   * Whether a strict-ip-bound session is being used from somewhere it was not opened.
   *
   * Strict binding is on for staff and off for customers by default, and that asymmetry is
   * the point: a customer on mobile data changes address constantly, while an admin session
   * jumping networks mid-life is worth refusing. A request that arrives with no address at
   * all is refused too when the row has one — an address that cannot be compared has not
   * been shown to match.
   */
  private static ipRejected(
    session: SessionWithUser,
    ip: string | null,
    settings: ResolvedAuthSettings,
  ): boolean {
    const strict = SessionService.isStaff(session.user.role)
      ? settings.staffStrictIpBinding
      : settings.customerStrictIpBinding;

    // Nothing was recorded to bind to, so there is nothing this check can assert. It is the
    // login path's job to capture an address, not this one's to invent one.
    if (!strict || session.ipAddress === null) {
      return false;
    }

    return ip !== session.ipAddress;
  }

  /**
   * Whether a token the session already rotated away from is a concurrent refresh rather
   * than a replay.
   *
   * A missing stamp is treated as a replay. `previousRotatedAt` is written by the same
   * statement that fills `previousRefreshTokenHash`, so a hash with no stamp is a row no code
   * path in this service can produce — and an unexplained state must not be the one that
   * grants access.
   *
   * So is a stamp in the future. The timestamp is written by the application clock, not by the
   * database, so a host whose clock ran ahead when the row was rotated leaves a stamp later
   * than "now" — and a negative elapsed time satisfies `<= graceMs` for the whole length of
   * the skew, forgiving every replay of that token until the clock catches up. A stamp that
   * has not happened yet cannot vouch for anything.
   *
   * The configured window is clamped here rather than trusted, because this is the only place
   * that acts on it: `refreshReuseGraceSeconds` is validated as a non-negative integer but has
   * no upper bound, so one mistyped value would otherwise switch replay detection off for as
   * long as it said, silently.
   */
  private static withinReuseGrace(
    session: SessionWithUser,
    settings: ResolvedAuthSettings,
  ): boolean {
    if (session.previousRotatedAt === null) {
      return false;
    }

    const elapsedMs = Date.now() - session.previousRotatedAt.getTime();

    if (elapsedMs < 0) {
      return false;
    }

    const graceSeconds = Math.min(
      settings.refreshReuseGraceSeconds,
      AuthConstants.RefreshReuseGraceMaxSeconds,
    );

    return elapsedMs <= graceSeconds * AuthConstants.MillisecondsPerSecond;
  }

  /**
   * The concurrent-refresh answer: a fresh access token, and the very refresh token that was
   * presented, handed straight back.
   *
   * Deliberately writes nothing. Five racing requests carry the same token; the first rotated
   * it and the rest are that same client. Rotating again for each would hand the client four
   * tokens it never asked for and, worse, push the hash the *first* response returned out of
   * the previous slot — killing the session the moment the client used the token it kept.
   * One rotation per generation of token, however many requests race for it.
   */
  private async reissueWithinGrace(
    session: SessionWithUser,
    deviceId: string,
    settings: ResolvedAuthSettings,
    presentedToken: string,
  ): Promise<ServiceResponse<IssuedSession>> {
    this.logger.debug({ sessionId: session.id }, 'Refresh inside the reuse grace window');

    const access = await this.signAccessToken(session.user, session.id, deviceId, settings);

    return serviceOk({
      accessToken: access.accessToken,
      expiresAt: access.expiresAt,
      // The *previous* generation's token, handed straight back. The row's current hash
      // belongs to whichever request won the rotation, and this service holds only that
      // token's hash — never its plaintext — so it physically cannot return the newer one.
      //
      // The contract that follows from it, which Task 9 owns and must state to clients: a
      // client may persist only a refresh token that came from a rotation, never one echoed
      // back inside the grace window. Keeping this one works until the grace window shuts,
      // after which it is indistinguishable from a replay — it will 401 *and* revoke the
      // session, and log a replay warning that no attacker caused. Serialising refreshes, or
      // keeping the newest response's token, both satisfy it.
      refreshToken: presentedToken,
      refreshExpiresAt: session.expiresAt,
      user: session.user,
    });
  }

  /** The ordinary refresh: mint a new token, keep the presented hash as the previous one. */
  private async rotateAndIssue(
    session: SessionWithUser,
    deviceId: string,
    settings: ResolvedAuthSettings,
    presentedHash: string,
    sighting: SessionSighting,
  ): Promise<ServiceResponse<IssuedSession>> {
    const nextRaw = randomBytes(AuthConstants.RefreshTokenBytes).toString('base64url');
    const rotated = await this.repository.rotate(
      session.id,
      SessionService.hashToken(nextRaw),
      presentedHash,
      SessionService.extendedIdleDeadline(session, settings),
      sighting,
    );

    if (!rotated) {
      // The old token is still the live one, so the client can retry with it. Handing back a
      // token whose hash was never stored would have burned the session instead.
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    const access = await this.signAccessToken(session.user, session.id, deviceId, settings);

    return serviceOk({
      accessToken: access.accessToken,
      expiresAt: access.expiresAt,
      refreshToken: nextRaw,
      refreshExpiresAt: rotated.expiresAt,
      user: session.user,
    });
  }

  /**
   * The idle deadline a refresh or a touch should write: a full idle window from now, capped
   * at the session's ceiling.
   *
   * Capped rather than merely compared, because two things read these columns — the guard and
   * the session listing — and an idle deadline beyond the ceiling would let them disagree
   * about whether a session is live.
   */
  private static extendedIdleDeadline(
    session: SessionWithUser,
    settings: ResolvedAuthSettings,
  ): Date {
    const window = SessionService.refreshWindow(session.user.role, settings);
    const extended = Date.now() + window.idleMinutes * AuthConstants.MillisecondsPerMinute;

    return new Date(Math.min(extended, session.absoluteExpiresAt.getTime()));
  }

  /**
   * Pushes the idle deadline forward, but at most once every
   * `AuthConstants.SessionTouchIntervalMinutes` — otherwise every authenticated request
   * on a busy session becomes a write, and the sliding window costs more than it protects.
   *
   * A session that has never been used slides immediately: `lastUsedAt` is null until the
   * first touch, and treating that as "used just now" would leave the very first window
   * un-slid.
   */
  private async slideIdleDeadline(
    session: SessionWithUser,
    settings: ResolvedAuthSettings,
  ): Promise<void> {
    const sinceLastUse = Date.now() - (session.lastUsedAt?.getTime() ?? 0);
    const intervalMs =
      AuthConstants.SessionTouchIntervalMinutes * AuthConstants.MillisecondsPerMinute;

    if (sinceLastUse < intervalMs) {
      return;
    }

    await this.repository.touch(session.id, SessionService.extendedIdleDeadline(session, settings));
  }

  /** The refresh deadlines for a role. Staff get the shorter pair. */
  private static refreshWindow(role: UserRole, settings: ResolvedAuthSettings): RefreshWindow {
    return SessionService.isStaff(role)
      ? {
          idleMinutes: settings.staffRefreshIdleMinutes,
          absoluteMinutes: settings.staffRefreshAbsoluteMinutes,
        }
      : {
          idleMinutes: settings.customerRefreshIdleMinutes,
          absoluteMinutes: settings.customerRefreshAbsoluteMinutes,
        };
  }

  /**
   * Signs an access token for a session, with the lifetime from settings.
   *
   * The access-token lifetime is deliberately unrelated to the refresh window: the refresh
   * window is how long a client may stay signed in without re-authenticating, while this is
   * how long a revocation can take to be noticed.
   */
  private async signAccessToken(
    user: User,
    sessionId: string,
    deviceId: string,
    settings: ResolvedAuthSettings,
  ): Promise<SignedAccess> {
    const accessToken = await this.tokens.sign(
      {
        userId: user.id,
        sessionId,
        role: user.role,
        // Phone-only accounts have no email. An empty claim is honest about that; leaving it
        // undefined would reach verification as the literal string "undefined", because the
        // claim is informational and so is not in `requiredClaims`.
        email: user.email ?? '',
        deviceId,
      },
      settings.accessTokenMinutes,
    );

    return {
      accessToken,
      expiresAt: SessionService.minutesAfter(Date.now(), settings.accessTokenMinutes),
    };
  }

  /** Every deadline in the auth settings is configured in minutes. */
  private static minutesAfter(from: number, minutes: number): Date {
    return new Date(from + minutes * AuthConstants.MillisecondsPerMinute);
  }
}

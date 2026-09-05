import { Session, User } from '../../infra/prisma/prisma-client';
import { LoginResponseDto } from './dto/login.dto';
import { SessionSummaryDto } from './dto/session.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { truncateIp } from './ip-truncation';
import { LoginResult, portalFor } from './login.service';
import { IssuedSession } from './sessions/session.service';

/**
 * Local user row to the profile contract.
 *
 * Lives here rather than in the user module because UserProfileDto does, and because two
 * identical mappers is both a drift risk and a build failure under
 * `sonarjs/no-identical-functions`. `GET /auth/me` and `PATCH /users/me` must never return
 * differently shaped payloads.
 */
export const AuthMapper = {
  toProfile(user: User): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      createdAt: user.createdAt,
    };
  },

  /**
   * An issued session to the wire contract. Used by both `POST /auth/login` (a fresh sign-in)
   * and `POST /auth/refresh` (a rotated one) — the shape a client receives must not depend on
   * which endpoint produced it. Never passes the Prisma `User` row through directly: it carries
   * `passwordHash` and `totpSecretEncrypted`, neither of which may leave this process.
   */
  toSessionResponse(session: IssuedSession): LoginResponseDto {
    return {
      kind: 'session',
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.refreshExpiresAt,
      portal: portalFor(session.user.role),
      user: AuthMapper.toProfile(session.user),
    };
  },

  toLoginResponse(result: LoginResult): LoginResponseDto {
    if (result.kind === 'session') {
      return { ...AuthMapper.toSessionResponse(result.session), portal: result.portal };
    }
    if (result.kind === 'mfa') {
      return { kind: 'mfa', mfaToken: result.mfaToken };
    }
    return { kind: 'enrolment', enrolmentToken: result.enrolmentToken };
  },

  /**
   * A live session row to the "where am I signed in" contract (`GET /auth/sessions`). Built
   * field by field rather than by spreading the row — see the class comment on
   * `SessionSummaryDto` for why. `current` compares against the session id the caller's own
   * access token carries, so exactly one row in a listing is ever `true`.
   */
  toSessionSummary(session: Session, currentSessionId: string): SessionSummaryDto {
    return {
      id: session.id,
      deviceId: session.deviceId,
      userAgent: session.userAgent,
      ipAddress: truncateIp(session.ipAddress),
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      current: session.id === currentSessionId,
    };
  },
} as const;

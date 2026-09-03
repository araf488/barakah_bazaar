import { User } from '../../infra/prisma/prisma-client';
import { LoginResponseDto } from './dto/login.dto';
import { UserProfileDto } from './dto/user-profile.dto';
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
      supabaseUserId: user.supabaseUserId,
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
} as const;

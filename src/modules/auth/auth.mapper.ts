import { User } from '../../infra/prisma/prisma-client';
import { UserProfileDto } from './dto/user-profile.dto';

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
} as const;

import { HttpStatus, Injectable } from '@nestjs/common';
import { User } from '../../infra/prisma/prisma-client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AuthRepository } from './auth.repository';
import { UserProfileDto } from './dto/user-profile.dto';

/**
 * Bridges a verified Supabase token to this system's own user record.
 *
 * The token proves identity; this service decides whether that identity may
 * still act — a disabled account holds a perfectly valid token right up to its
 * expiry, so `isActive` has to be checked against the database.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  /** Provisions the local user row on first sight, then returns the profile. */
  async resolveProfile(authenticated: AuthenticatedUser): Promise<ServiceResponse<UserProfileDto>> {
    try {
      const user = await this.repository.upsertFromToken(authenticated);

      if (!user) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (!user.isActive) {
        this.logger.warn(
          { supabaseUserId: authenticated.supabaseUserId },
          'Disabled account attempted to authenticate',
        );
        return serviceFail(HttpStatus.FORBIDDEN, ErrorMessages.AccountDisabled);
      }

      return serviceOk(AuthService.toProfile(user));
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId },
        'Exception occurred in AuthService.resolveProfile',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  private static toProfile(user: User): UserProfileDto {
    return {
      id: user.id,
      supabaseUserId: user.supabaseUserId,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}

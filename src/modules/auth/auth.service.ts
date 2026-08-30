import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AuthMapper } from './auth.mapper';
import { AuthConstants } from './auth.constants';
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

      return serviceOk(AuthMapper.toProfile(user));
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId },
        'Exception occurred in AuthService.resolveProfile',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Resolves the local user id for a verified token, without provisioning.
   *
   * Deliberately not `resolveProfile`: that upserts on every call, which would turn every
   * address read into a write. A client that never called `/auth/me` has no local row yet
   * and gets a 404 saying so.
   */
  async resolveActiveUserId(authenticated: AuthenticatedUser): Promise<ServiceResponse<string>> {
    try {
      const user = await this.repository.findBySupabaseId(authenticated.supabaseUserId);

      if (user === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (user === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, AuthConstants.UserResourceName),
        );
      }

      if (!user.isActive) {
        this.logger.warn(
          { supabaseUserId: authenticated.supabaseUserId },
          'Disabled account attempted an authenticated operation',
        );
        return serviceFail(HttpStatus.FORBIDDEN, ErrorMessages.AccountDisabled);
      }

      return serviceOk(user.id);
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId },
        'Exception occurred in AuthService.resolveActiveUserId',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }
}

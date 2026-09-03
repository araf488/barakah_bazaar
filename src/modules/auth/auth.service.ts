import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AuthMapper } from './auth.mapper';
import { AuthRepository } from './auth.repository';
import { UserProfileDto } from './dto/user-profile.dto';

/**
 * The local half of "who is calling".
 *
 * SessionAuthGuard has already read the `users` row and enforced `isActive` by the time any
 * of this runs — there is no Supabase-era provisioning step left, because a row exchanged for
 * a third-party token no longer exists as a concept: the local row is created at signup.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  /** The caller's own profile. Reads the row the guard already proved exists and is active. */
  async resolveProfile(authenticated: AuthenticatedUser): Promise<ServiceResponse<UserProfileDto>> {
    try {
      const user = await this.repository.findById(authenticated.userId);

      if (user === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (user === undefined) {
        // Guarded against by SessionAuthGuard moments earlier — reachable only if the row was
        // deleted in the gap between the guard's read and this one.
        return serviceFail(HttpStatus.NOT_FOUND, ErrorMessages.InvalidAccessToken);
      }

      return serviceOk(AuthMapper.toProfile(user));
    } catch (error) {
      this.logger.error(
        { err: error, userId: authenticated.userId },
        'Exception occurred in AuthService.resolveProfile',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * The local user id for the caller.
   *
   * Keeps its signature from when it was a database lookup, deliberately: about forty call
   * sites across cart, order, review, payment, inventory, warehouse and admin pass an
   * AuthenticatedUser to it, and none of them need to change. The guard has already resolved
   * the row and enforced `isActive`, so there is nothing left to look up.
   */
  async resolveActiveUserId(authenticated: AuthenticatedUser): Promise<ServiceResponse<string>> {
    return Promise.resolve(serviceOk(authenticated.userId));
  }
}

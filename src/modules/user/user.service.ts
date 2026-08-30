import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AuthMapper } from '../auth/auth.mapper';
import { AuthService } from '../auth/auth.service';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserRepository } from './user.repository';

/**
 * The editable half of a customer profile.
 *
 * The local user id is resolved from the verified token, never taken from the request —
 * there is no route or body field that could name another user.
 */
@Injectable()
export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly authService: AuthService,
    @InjectPinoLogger(UserService.name) private readonly logger: PinoLogger,
  ) {}

  async updateProfile(
    authenticated: AuthenticatedUser,
    dto: UpdateProfileDto,
  ): Promise<ServiceResponse<UserProfileDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(authenticated);

      if (!owner.ok) {
        return owner;
      }

      const updated = await this.repository.updateFullName(owner.data, dto.fullName);

      if (!updated) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(AuthMapper.toProfile(updated));
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId },
        'Exception occurred in UserService.updateProfile',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }
}

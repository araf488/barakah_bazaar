import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../../common/types/service-response';
import { AuthMessages } from '../auth.constants';
import { AuthRepository } from '../auth.repository';
import { PasswordHasher } from '../crypto/password-hasher';
import { PasswordUpdater } from './password-updater';

/**
 * Changes the password of a signed-in caller who still knows the current one.
 *
 * Requiring the current password is what makes a general step-up mechanism unnecessary here.
 * Unlike a reset, the calling session survives: only the caller's *other* sessions end.
 */
@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly users: AuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly updater: PasswordUpdater,
    @InjectPinoLogger(PasswordChangeService.name) private readonly logger: PinoLogger,
  ) {}

  async change(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<ServiceResponse<void>> {
    try {
      const user = await this.users.findById(userId);

      if (user === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      // `undefined` means the guard validated this session moments ago and the row has since
      // gone: a deleted account, answered like a bad credential.
      const currentOk =
        user !== undefined &&
        !!user.passwordHash &&
        (await this.hasher.verify(currentPassword, user.passwordHash));

      if (!currentOk) {
        return serviceFail(HttpStatus.UNAUTHORIZED, AuthMessages.InvalidCredentials);
      }

      const replaced = await this.updater.replace(user, newPassword, sessionId);
      if (!replaced.ok) {
        return replaced;
      }

      await this.updater.announce(user);

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in PasswordChangeService.change',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }
}

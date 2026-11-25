import { Body, Controller, HttpStatus, Patch, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserConstants } from './user.constants';
import { UserService } from './user.service';

/**
 * The caller's own profile.
 *
 * The read stays on `GET /auth/me`, which provisions the local row on first sight;
 * duplicating it here would mean two routes serving one payload.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller(UserConstants.RouteBase)
export class UserController {
  constructor(
    private readonly userService: UserService,
    @InjectPinoLogger(UserController.name) private readonly logger: PinoLogger,
  ) {}

  @Patch('me')
  @ApiOperation({ summary: "Update the current user's display name" })
  @ApiResponse({ status: HttpStatus.OK, type: UserProfileDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Account disabled' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No local user row yet' })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    try {
      if (!user) {
        throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
      }
      return unwrapOrThrow(await this.userService.updateProfile(user, dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in UserController.updateProfile');
      throw error;
    }
  }
}

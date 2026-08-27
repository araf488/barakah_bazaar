import { Controller, Get, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { AuthService } from './auth.service';
import { UserProfileDto } from './dto/user-profile.dto';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectPinoLogger(AuthController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Returns the caller's profile, provisioning the local user row on first
   * call. Clients hit this immediately after a Supabase sign-in to exchange a
   * token for the application-side identity.
   */
  @Get('me')
  @ApiOperation({ summary: "Get the current user's profile" })
  @ApiResponse({ status: HttpStatus.OK, type: UserProfileDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Account disabled' })
  async me(@CurrentUser() user: AuthenticatedUser | undefined): Promise<UserProfileDto> {
    try {
      if (!user) {
        throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
      }
      return unwrapOrThrow(await this.authService.resolveProfile(user));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.me');
      throw error;
    }
  }
}

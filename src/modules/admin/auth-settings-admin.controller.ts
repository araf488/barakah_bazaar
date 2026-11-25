import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AdminConstants } from './admin.constants';
import { AuthSettingsAdminService } from './auth-settings-admin.service';
import {
  AuthSettingsUpdatedDto,
  AuthSettingsViewDto,
  UpdateAuthSettingsDto,
} from './dto/auth-settings.dto';

/**
 * Token lifetimes and the staff MFA requirement.
 *
 * `SUPER_ADMIN` only, for both routes: these settings decide how long a stolen token keeps
 * working and whether staff sign-in needs a second factor, so changing them is as sensitive as
 * granting a role. Even the read is restricted — it tells an attacker exactly how long a
 * captured refresh token stays usable.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller(`${AdminConstants.RouteBase}/auth-settings`)
export class AuthSettingsAdminController {
  constructor(
    private readonly settings: AuthSettingsAdminService,
    @InjectPinoLogger(AuthSettingsAdminController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The auth settings in force, and any field that fell back' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSettingsViewDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not a super admin' })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, description: 'Settings unreadable' })
  async view(): Promise<AuthSettingsViewDto> {
    try {
      return unwrapOrThrow(await this.settings.view());
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsAdminController.view');
      throw error;
    }
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change auth settings — merged over the settings in force, then validated',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSettingsUpdatedDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Nothing to change, a rule violated, or staff MFA turned off without confirmDisableStaffMfa',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not a super admin' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'The settings changed since they were read; reload and retry',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Settings unreadable, or the write and its audit row could not be recorded',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAuthSettingsDto,
  ): Promise<AuthSettingsUpdatedDto> {
    try {
      return unwrapOrThrow(await this.settings.update(user, dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsAdminController.update');
      throw error;
    }
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AdminConstants } from './admin.constants';
import { AdminUserService } from './admin-user.service';
import { AdminUserDto, AdminUserQueryDto, ChangeRoleDto } from './dto/admin-user.dto';

/**
 * Staff and customer accounts.
 *
 * Roles differ per route on purpose. SUPPORT needs to find a customer and disable a
 * fraudulent account, so it shares the read and the enable/disable routes. It must not be
 * able to grant itself SUPER_ADMIN, so the role change is SUPER_ADMIN only — that route is
 * the privilege-escalation path and is guarded accordingly.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller(`${AdminConstants.RouteBase}/users`)
export class AdminUserController {
  constructor(
    private readonly userService: AdminUserService,
    @InjectPinoLogger(AdminUserController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Search customers and staff' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN })
  async list(@Query() query: AdminUserQueryDto): Promise<PaginatedResponseDto<AdminUserDto>> {
    try {
      return unwrapOrThrow(await this.userService.listUsers(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminUserController.list');
      throw error;
    }
  }

  @Patch(':id/disable')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Disable an account — takes effect on the next request' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminUserDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Own account' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Last super admin' })
  async disable(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUserDto> {
    try {
      return unwrapOrThrow(
        await this.userService.setAccountEnabled(AdminUserController.require(user), id, false),
      );
    } catch (error) {
      this.logger.error(
        { err: error, targetId: id },
        'Exception occurred in AdminUserController.disable',
      );
      throw error;
    }
  }

  @Patch(':id/enable')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SUPPORT)
  @ApiOperation({ summary: 'Re-enable a disabled account' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminUserDto })
  async enable(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUserDto> {
    try {
      return unwrapOrThrow(
        await this.userService.setAccountEnabled(AdminUserController.require(user), id, true),
      );
    } catch (error) {
      this.logger.error(
        { err: error, targetId: id },
        'Exception occurred in AdminUserController.enable',
      );
      throw error;
    }
  }

  /**
   * SUPER_ADMIN only. This is the privilege-escalation route: anyone who can call it can
   * grant themselves anything, so SUPPORT is deliberately excluded even though it holds the
   * other routes on this controller.
   */
  @Patch(':id/role')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Change a staff member's role" })
  @ApiResponse({ status: HttpStatus.OK, type: AdminUserDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Own account, or not a super admin' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Last super admin' })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, description: 'Identity provider refused' })
  async changeRole(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<AdminUserDto> {
    try {
      return unwrapOrThrow(
        await this.userService.changeRole(AdminUserController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, targetId: id },
        'Exception occurred in AdminUserController.changeRole',
      );
      throw error;
    }
  }

  private static require(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }
    return user;
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AdminConstants } from './admin.constants';
import { StaffInvitationService } from './staff-invitation.service';
import {
  AcceptInvitationDto,
  InvitationCreatedDto,
  InvitationListDto,
  InvitationQueryDto,
  InviteStaffDto,
  StaffInvitationDto,
} from './dto/staff-invitation.dto';

/**
 * Staff invitations.
 *
 * `SUPER_ADMIN` only, and narrower than the rest of the admin surface on purpose: an
 * invitation is a pending permission grant, so anyone who can send one can create a
 * colleague at any role. OPS runs orders; it does not decide who else gets access.
 *
 * Note the acceptance route is NOT on this controller — see StaffInvitationAcceptController.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller(`${AdminConstants.RouteBase}/staff/invitations`)
export class StaffInvitationController {
  constructor(
    private readonly invitations: StaffInvitationService,
    @InjectPinoLogger(StaffInvitationController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Invitations, newest first' })
  @ApiResponse({ status: HttpStatus.OK, type: InvitationListDto })
  async list(@Query() query: InvitationQueryDto): Promise<InvitationListDto> {
    try {
      return unwrapOrThrow(await this.invitations.list(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in StaffInvitationController.list');
      throw error;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Invite someone to a staff role' })
  @ApiResponse({ status: HttpStatus.CREATED, type: InvitationCreatedDto })
  async invite(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: InviteStaffDto,
  ): Promise<InvitationCreatedDto> {
    try {
      return unwrapOrThrow(await this.invitations.invite(actor, dto));
    } catch (error) {
      // The email is safe to log; the token never reaches this layer.
      this.logger.error(
        { err: error, email: dto.email },
        'Exception occurred in StaffInvitationController.invite',
      );
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw an invitation that has not been accepted' })
  @ApiResponse({ status: HttpStatus.OK, type: StaffInvitationDto })
  async revoke(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StaffInvitationDto> {
    try {
      return unwrapOrThrow(await this.invitations.revoke(actor, id));
    } catch (error) {
      this.logger.error(
        { err: error, invitationId: id },
        'Exception occurred in StaffInvitationController.revoke',
      );
      throw error;
    }
  }
}

/**
 * Taking up an invitation.
 *
 * A separate controller because it carries **no `@Roles`**, and it must not: the invitee has
 * no staff role yet — granting them one is the entire point. Folding this route into the
 * `SUPER_ADMIN`-guarded controller above would make it unreachable by exactly the people it
 * exists for.
 *
 * It is still authenticated. The caller must already be signed in as the invited address, and
 * the service refuses when the signed-in email does not match the invitation.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('staff/invitations')
export class StaffInvitationAcceptController {
  constructor(
    private readonly invitations: StaffInvitationService,
    @InjectPinoLogger(StaffInvitationAcceptController.name) private readonly logger: PinoLogger,
  ) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a staff invitation as the signed-in account' })
  @ApiResponse({ status: HttpStatus.OK, type: StaffInvitationDto })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptInvitationDto,
  ): Promise<StaffInvitationDto> {
    try {
      return unwrapOrThrow(await this.invitations.accept(user, dto));
    } catch (error) {
      // The token is deliberately absent from this log line: it is a live credential.
      this.logger.error(
        { err: error, supabaseUserId: user.supabaseUserId },
        'Exception occurred in StaffInvitationAcceptController.accept',
      );
      throw error;
    }
  }
}

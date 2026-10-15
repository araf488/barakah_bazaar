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
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ThrottleBuckets } from '../../config/throttler.config';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AdminConstants } from './admin.constants';
import { StaffInvitationAcceptService } from './staff-invitation-accept.service';
import { StaffInvitationService } from './staff-invitation.service';
import {
  AcceptInvitationDto,
  InvitationAcceptedDto,
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

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue a fresh link for an open invitation; the old link stops working',
  })
  @ApiResponse({ status: HttpStatus.OK, type: InvitationCreatedDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such invitation' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The id is not a UUID' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not a super admin' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The invitation is no longer open' })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Database fault, or the audit row could not be recorded',
  })
  async resend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationCreatedDto> {
    try {
      return unwrapOrThrow(await this.invitations.resend(actor, id));
    } catch (error) {
      this.logger.error(
        { err: error, invitationId: id },
        'Exception occurred in StaffInvitationController.resend',
      );
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw an invitation that has not been accepted' })
  @ApiResponse({ status: HttpStatus.OK, type: StaffInvitationDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The id is not a UUID' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not a super admin' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such invitation' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The invitation is no longer open' })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Database fault, or the audit row could not be recorded',
  })
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
 * **Public**, because the invitee has no account yet and so nothing to sign in with: the emailed
 * token is the credential. It carries no `@Roles` for the same reason, and it joins the per-IP
 * auth throttle bucket since it is an unauthenticated token-guessing surface.
 *
 * The account is created here with a verified email. **No session is returned**: staff accounts
 * require a second factor, so the invitee signs in afterwards and enrols MFA. An address that
 * already has an account gets a 409, and the admin role-change endpoint is the path for it.
 */
@ApiTags('Admin')
@Controller('staff/invitations')
export class StaffInvitationAcceptController {
  constructor(
    private readonly invitations: StaffInvitationAcceptService,
    @InjectPinoLogger(StaffInvitationAcceptController.name) private readonly logger: PinoLogger,
  ) {}

  @Public()
  @RateLimit(ThrottleBuckets.AuthIp)
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a staff invitation by creating the account it offers' })
  @ApiResponse({ status: HttpStatus.OK, type: InvitationAcceptedDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid payload or weak password' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invalid link' })
  @ApiResponse({ status: HttpStatus.GONE, description: 'Expired' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Account exists, or already accepted' })
  async accept(@Body() dto: AcceptInvitationDto): Promise<InvitationAcceptedDto> {
    try {
      return unwrapOrThrow(await this.invitations.accept(dto));
    } catch (error) {
      // The token is deliberately absent from this log line: it is a live credential.
      this.logger.error(
        { err: error },
        'Exception occurred in StaffInvitationAcceptController.accept',
      );
      throw error;
    }
  }
}

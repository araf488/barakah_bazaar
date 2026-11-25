import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AdminConstants } from './admin.constants';
import { AuditLogService } from './audit-log.service';
import { AuditLogEntryDto, AuditLogQueryDto } from './dto/audit-log.dto';

/**
 * Backoffice endpoints.
 *
 * Every route names the roles that may call it — there is no default-allow for staff routes,
 * so a route that forgets `@Roles` is open to any signed-in customer. The audit trail itself
 * is SUPER_ADMIN only: it records who changed prices and permissions, which is not something
 * every staff role should be able to read.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller(AdminConstants.RouteBase)
export class AdminController {
  constructor(
    private readonly auditLogService: AuditLogService,
    @InjectPinoLogger(AdminController.name) private readonly logger: PinoLogger,
  ) {}

  @Get('audit-log')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Search the staff audit trail' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not a super admin' })
  async listAuditLog(
    @Query() query: AuditLogQueryDto,
  ): Promise<PaginatedResponseDto<AuditLogEntryDto>> {
    try {
      return unwrapOrThrow(await this.auditLogService.listEntries(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminController.listAuditLog');
      throw error;
    }
  }
}

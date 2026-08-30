import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Prisma } from '../../infra/prisma/prisma-client';
import { AdminAuditAction } from './admin.constants';
import { AdminMapper } from './admin.mapper';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogEntryDto, AuditLogQueryDto } from './dto/audit-log.dto';

/** What a calling service knows about the change it just made. */
export interface AuditContext {
  readonly actor: AuthenticatedUser;
  /** The local `users.id`, resolved by the caller — the token carries only the Supabase id. */
  readonly actorId: string;
  readonly action: AdminAuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  /** The `x-request-id` of the call, so a log line ties back to an audit row. */
  readonly requestId?: string | null;
}

/**
 * The audit trail every staff write appends to.
 *
 * `record` returns a boolean rather than throwing, and **the caller must decide what a false
 * means**. That decision differs by operation: losing the record of a catalog description
 * edit is regrettable, losing the record of a price change or a role grant is not
 * acceptable, so money- and permission-touching operations must treat false as a failure
 * and refuse the write. `AdminMessages.AuditTrailUnavailable` is the message for that.
 *
 * Deliberately NOT swallowed inside the repository call chain: a silent audit gap is the one
 * failure mode an audit log cannot have.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly repository: AuditLogRepository,
    @InjectPinoLogger(AuditLogService.name) private readonly logger: PinoLogger,
  ) {}

  async record(context: AuditContext): Promise<boolean> {
    try {
      const written = await this.repository.append({
        actorId: context.actorId,
        actorEmail: context.actor.email ?? null,
        actorRole: context.actor.role,
        action: context.action,
        entityType: context.entityType,
        entityId: context.entityId ?? null,
        before: AuditLogService.toJson(context.before),
        after: AuditLogService.toJson(context.after),
        requestId: context.requestId ?? null,
      });

      if (!written) {
        // Loud on purpose: this is the log line an operator greps for when reconciling a
        // change that has no audit row.
        this.logger.error(
          { action: context.action, entityType: context.entityType, entityId: context.entityId },
          'Audit trail write failed; the change it describes is NOT recorded',
        );
      }

      return written;
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuditLogService.record');
      return false;
    }
  }

  async listEntries(
    query: AuditLogQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<AuditLogEntryDto>>> {
    try {
      const page = await this.repository.findPage(query);

      if (page === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(
        PaginatedResponseDto.of(
          AdminMapper.toAuditEntries(page.items),
          page.total,
          query.page,
          query.limit,
        ),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuditLogService.listEntries');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Prisma's Json column cannot hold a BigInt, and every price in this system is BigInt
   * poysha — so an audited price change would throw at write time without this.
   *
   * The replacer is explicit rather than relying on `installBigIntJsonSerializer()`, which
   * `main.ts` installs globally: this service must behave the same when constructed outside
   * the bootstrap, and a global side-effect is not a dependency worth having. Poysha values
   * are far below `Number.MAX_SAFE_INTEGER`, so the narrowing is lossless here.
   */
  private static toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const serialised = JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? Number(item) : item,
    );

    return JSON.parse(serialised) as Prisma.InputJsonValue;
  }
}

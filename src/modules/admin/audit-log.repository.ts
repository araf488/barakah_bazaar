import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AdminAuditLog, Prisma } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log.dto';

/** Everything one audit row records. Assembled by AuditLogService, never by a caller. */
export interface AuditLogWriteData {
  actorId: string;
  actorEmail: string | null;
  actorRole: Prisma.AdminAuditLogCreateInput['actorRole'];
  action: string;
  entityType: string;
  entityId: string | null;
  before: Prisma.InputJsonValue | undefined;
  after: Prisma.InputJsonValue | undefined;
  requestId: string | null;
}

export interface AuditLogPage {
  items: AdminAuditLog[];
  total: number;
}

/**
 * Append-only persistence for the audit trail.
 *
 * There is deliberately no update and no delete: an audit log that can be edited is not an
 * audit log. The only writer is `append`.
 */
@Injectable()
export class AuditLogRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AuditLogRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Appends inside an existing transaction, so a business write and its audit row succeed or
   * fail together. This is what makes the trail trustworthy for money: there is no window in
   * which a price changed but the record of who changed it did not.
   *
   * Throws on failure, deliberately — the caller's transaction must roll back.
   */
  async appendWithin(tx: Prisma.TransactionClient, data: AuditLogWriteData): Promise<void> {
    await tx.adminAuditLog.create({ data });
  }

  /** Returns false when the row could not be written. The caller decides what that means. */
  async append(data: AuditLogWriteData): Promise<boolean> {
    try {
      await this.prisma.adminAuditLog.create({ data });
      return true;
    } catch (error) {
      this.logger.error(
        { err: error, action: data.action, entityType: data.entityType },
        'Exception occurred in AuditLogRepository.append',
      );
      return false;
    }
  }

  async findPage(query: AuditLogQueryDto): Promise<AuditLogPage | null> {
    try {
      const where = AuditLogRepository.buildWhere(query);

      const [items, total] = await this.prisma.$transaction([
        this.prisma.adminAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.adminAuditLog.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuditLogRepository.findPage');
      return null;
    }
  }

  private static buildWhere(query: AuditLogQueryDto): Prisma.AdminAuditLogWhereInput {
    const where: Prisma.AdminAuditLogWhereInput = {};

    if (query.action) {
      where.action = query.action;
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.entityId) {
      where.entityId = query.entityId;
    }

    if (query.actorId) {
      where.actorId = query.actorId;
    }

    const createdAt = AuditLogRepository.buildRange(query);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    return where;
  }

  /** `from` is inclusive and `until` exclusive, so adjacent day ranges do not double-count. */
  private static buildRange(query: AuditLogQueryDto): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.until) {
      return undefined;
    }

    return {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.until ? { lt: new Date(query.until) } : {}),
    };
  }
}

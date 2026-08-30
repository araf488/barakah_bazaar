import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma, User, UserRole } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from './audit-log.repository';
import { AdminUserQueryDto } from './dto/admin-user.dto';

/** `undefined` = no such user; `null` = the query failed. */
export type AdminUserResult = User | null | undefined;

export interface AdminUserPage {
  items: User[];
  total: number;
}

/**
 * Staff-side view of the user table.
 *
 * Separate from `AuthRepository`, which owns provisioning and is scoped to one caller's own
 * row. Everything here reads or writes somebody else's account, which is exactly why every
 * mutation carries an audit row.
 */
@Injectable()
export class AdminUserRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(AdminUserRepository.name) private readonly logger: PinoLogger,
  ) {}

  async findById(id: string): Promise<AdminUserResult> {
    try {
      return (await this.prisma.user.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, userId: id },
        'Exception occurred in AdminUserRepository.findById',
      );
      return null;
    }
  }

  async findPage(query: AdminUserQueryDto): Promise<AdminUserPage | null> {
    try {
      const where = AdminUserRepository.buildWhere(query);

      const [items, total] = await this.prisma.$transaction([
        this.prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.user.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminUserRepository.findPage');
      return null;
    }
  }

  /** How many enabled super admins exist. Guards against locking everyone out. */
  async countActiveSuperAdmins(): Promise<number | null> {
    try {
      return await this.prisma.user.count({
        where: { role: UserRole.SUPER_ADMIN, isActive: true },
      });
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in AdminUserRepository.countActiveSuperAdmins',
      );
      return null;
    }
  }

  /**
   * Updates a user and writes its audit row in ONE transaction.
   *
   * Same reasoning as the catalog: an account that was disabled, or a role that changed,
   * without a record of who did it is the outcome the trail exists to prevent.
   */
  async updateAudited(
    id: string,
    data: Prisma.UserUpdateInput,
    audit: (updated: User) => AuditLogWriteData,
  ): Promise<AdminUserResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data });
        await this.auditLog.appendWithin(tx, audit(updated));
        return updated;
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: id },
        'Exception occurred in AdminUserRepository.updateAudited',
      );
      return null;
    }
  }

  private static buildWhere(query: AdminUserQueryDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (query.role) {
      where.role = query.role;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { fullName: { contains: term, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}

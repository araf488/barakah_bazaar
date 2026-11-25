import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Language, Prisma, User, UserRole } from '../../infra/prisma/prisma-client';
import { PrismaErrorCodes } from '../../common/constants/app.constants';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthTokens } from '../auth/auth.constants';
import { SessionCachePort } from '../auth/sessions/session-cache.port';
import { AuditLogRepository, AuditLogWriteData } from './audit-log.repository';
import { AdminUserQueryDto } from './dto/admin-user.dto';

/** `undefined` = no such user; `null` = the query failed. */
export type AdminUserResult = User | null | undefined;

/** What staff supply to open a customer account. The role is not among them. */
export interface NewCustomerData {
  email: string;
  fullName: string;
  preferredLanguage: Language;
  passwordHash: string;
}

export type CreateCustomerResult = { kind: 'created'; user: User } | { kind: 'exists' } | null;

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
    @Inject(AuthTokens.SessionCache) private readonly sessionCache: SessionCachePort,
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
   *
   * The single choke point for every admin-side user mutation, which is why the cached
   * session generation is bumped here rather than in each of `setAccountEnabled` and
   * `changeRole`: a role change or a disabled account must stop validating from a stale cache
   * entry on the very next request (Task 9's row-wins guarantee for `role`, and the same
   * reasoning for `isActive`), and one edit here covers both today and any admin mutation
   * added here later.
   */
  async updateAudited(
    id: string,
    data: Prisma.UserUpdateInput,
    audit: (updated: User) => AuditLogWriteData,
  ): Promise<AdminUserResult> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.user.update({ where: { id }, data });
        await this.auditLog.appendWithin(tx, audit(row));
        return row;
      });

      // After the transaction returns, not inside it: bumping before commit leaves a window
      // where a concurrent read repopulates the cache from the pre-write row. Unconditional
      // rather than keyed to which fields changed — a spurious bump costs one extra database
      // read on this user's next request; a missed one leaves a demoted or disabled account
      // still validating from cache.
      await this.sessionCache.invalidateUser(id);

      return updated;
    } catch (error) {
      this.logger.error(
        { err: error, userId: id },
        'Exception occurred in AdminUserRepository.updateAudited',
      );
      return null;
    }
  }

  /**
   * Creates a customer and writes its audit row in ONE transaction.
   *
   * The role is fixed to CUSTOMER here, after the spread, so no caller can mint staff through
   * this path. A unique-email rejection is an expected outcome and comes back as data; any other
   * fault is `null`. The password hash is never logged.
   */
  async createCustomerAudited(
    data: NewCustomerData,
    audit: (created: User) => AuditLogWriteData,
  ): Promise<CreateCustomerResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { ...data, role: UserRole.CUSTOMER, isActive: true, emailVerifiedAt: null },
        });
        await this.auditLog.appendWithin(tx, audit(created));
        return { kind: 'created', user: created } as const;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCodes.UniqueConstraint
      ) {
        // `users.email` is the only unique column this transaction can hit.
        this.logger.info('Customer creation found an existing account; nothing created');
        return { kind: 'exists' };
      }

      this.logger.error(
        { err: error },
        'Exception occurred in AdminUserRepository.createCustomerAudited',
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

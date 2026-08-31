import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma, Promotion, PromotionType } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from '../admin/audit-log.repository';

export type PromotionResult = Promotion | null | undefined;

export interface PromotionWriteData {
  code: string;
  nameEn: string;
  nameBn: string | null;
  type: PromotionType;
  value: bigint;
  minSubtotalPoysha: bigint;
  maxDiscountPoysha: bigint | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  isActive: boolean;
}

/** How many times a promotion has been redeemed, in total and by one customer. */
export interface RedemptionCounts {
  total: number;
  byCustomer: number;
}

@Injectable()
export class PromotionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(PromotionRepository.name) private readonly logger: PinoLogger,
  ) {}

  async findByCode(code: string): Promise<PromotionResult> {
    try {
      return (await this.prisma.promotion.findUnique({ where: { code } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, code },
        'Exception occurred in PromotionRepository.findByCode',
      );
      return null;
    }
  }

  async findById(id: string): Promise<PromotionResult> {
    try {
      return (await this.prisma.promotion.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, promotionId: id },
        'Exception occurred in PromotionRepository.findById',
      );
      return null;
    }
  }

  /**
   * Usage counted from the redemption ledger, never from a counter on the promotion.
   *
   * A `timesUsed` column is the classic way to oversell a coupon: two checkouts read the same
   * value, both find room, and both write the same increment.
   */
  async countRedemptions(promotionId: string, userId: string): Promise<RedemptionCounts | null> {
    try {
      const [total, byCustomer] = await this.prisma.$transaction([
        this.prisma.promotionRedemption.count({ where: { promotionId } }),
        this.prisma.promotionRedemption.count({ where: { promotionId, userId } }),
      ]);

      return { total, byCustomer };
    } catch (error) {
      this.logger.error(
        { err: error, promotionId },
        'Exception occurred in PromotionRepository.countRedemptions',
      );
      return null;
    }
  }

  async createAudited(
    data: PromotionWriteData,
    audit: (created: Promotion) => AuditLogWriteData,
  ): Promise<Promotion | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.promotion.create({ data });
        await this.auditLog.appendWithin(tx, audit(created));
        return created;
      });
    } catch (error) {
      // A duplicate code lands here on the unique index.
      this.logger.error(
        { err: error, code: data.code },
        'Exception occurred in PromotionRepository.createAudited',
      );
      return null;
    }
  }

  async updateAudited(
    id: string,
    data: Partial<PromotionWriteData>,
    audit: (updated: Promotion) => AuditLogWriteData,
  ): Promise<Promotion | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.promotion.update({ where: { id }, data });
        await this.auditLog.appendWithin(tx, audit(updated));
        return updated;
      });
    } catch (error) {
      this.logger.error(
        { err: error, promotionId: id },
        'Exception occurred in PromotionRepository.updateAudited',
      );
      return null;
    }
  }

  async findPage(
    where: Prisma.PromotionWhereInput,
    skip: number,
    take: number,
  ): Promise<{ items: Promotion[]; total: number } | null> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.promotion.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
        this.prisma.promotion.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PromotionRepository.findPage');
      return null;
    }
  }
}

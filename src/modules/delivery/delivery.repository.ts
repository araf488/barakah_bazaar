import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DeliveryZone, DeliveryZoneRule, Prisma } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from '../admin/audit-log.repository';

export type ZoneWithRules = Prisma.DeliveryZoneGetPayload<{ include: { rules: true } }>;
export type ZoneResult = ZoneWithRules | null | undefined;

export interface ZoneWriteData {
  nameEn: string;
  nameBn: string | null;
  feePoysha: bigint;
  freeAbovePoysha: bigint | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface RuleSpec {
  division: string;
  district: string | null;
  unit: string | null;
}

@Injectable()
export class DeliveryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(DeliveryRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Every rule that could apply to one address, plus the default zone.
   *
   * Deliberately one query rather than three increasingly specific ones: the candidate set is
   * tiny, and picking the winner in memory keeps the precedence rule in a single readable
   * place instead of spread across three round trips.
   */
  async findCandidates(
    division: string,
    district: string,
    unit: string,
  ): Promise<{
    rules: (DeliveryZoneRule & { zone: DeliveryZone })[];
    fallback: DeliveryZone | null;
  } | null> {
    try {
      const [rules, fallback] = await this.prisma.$transaction([
        this.prisma.deliveryZoneRule.findMany({
          where: {
            zone: { isActive: true },
            division,
            OR: [
              { district: null, unit: null },
              { district, unit: null },
              { district, unit },
            ],
          },
          include: { zone: true },
        }),
        this.prisma.deliveryZone.findFirst({ where: { isDefault: true, isActive: true } }),
      ]);

      return { rules, fallback };
    } catch (error) {
      this.logger.error(
        { err: error, division, district, unit },
        'Exception occurred in DeliveryRepository.findCandidates',
      );
      return null;
    }
  }

  /** Creates a zone with its rules and its audit row, all or nothing. */
  async createAudited(
    data: ZoneWriteData,
    rules: RuleSpec[],
    audit: (created: ZoneWithRules) => AuditLogWriteData,
  ): Promise<ZoneWithRules | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.deliveryZone.create({
          data: { ...data, rules: { create: rules } },
          include: { rules: true },
        });

        await this.auditLog.appendWithin(tx, audit(created));
        return created;
      });
    } catch (error) {
      // A place already claimed by another zone lands here on the unique index, which is what
      // makes overlapping pricing impossible rather than merely discouraged.
      this.logger.error(
        { err: error, nameEn: data.nameEn },
        'Exception occurred in DeliveryRepository.createAudited',
      );
      return null;
    }
  }

  /**
   * Replaces a zone's fields and its whole rule set, with its audit row, in one transaction.
   *
   * Rules are replaced rather than diffed: a partial rule update is how a place ends up in two
   * zones or none, and the set is small enough that rewriting it is cheaper than reasoning
   * about which half applied.
   */
  async updateAudited(
    id: string,
    data: Partial<ZoneWriteData>,
    rules: RuleSpec[] | null,
    audit: (updated: ZoneWithRules) => AuditLogWriteData,
  ): Promise<ZoneWithRules | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (rules) {
          await tx.deliveryZoneRule.deleteMany({ where: { zoneId: id } });
        }

        const updated = await tx.deliveryZone.update({
          where: { id },
          data: { ...data, ...(rules ? { rules: { create: rules } } : {}) },
          include: { rules: true },
        });

        await this.auditLog.appendWithin(tx, audit(updated));
        return updated;
      });
    } catch (error) {
      this.logger.error(
        { err: error, zoneId: id },
        'Exception occurred in DeliveryRepository.updateAudited',
      );
      return null;
    }
  }

  async findById(id: string): Promise<ZoneResult> {
    try {
      return (
        (await this.prisma.deliveryZone.findUnique({ where: { id }, include: { rules: true } })) ??
        undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, zoneId: id },
        'Exception occurred in DeliveryRepository.findById',
      );
      return null;
    }
  }

  /** The zone currently marked default, if any. */
  async findDefault(): Promise<ZoneResult> {
    try {
      return (
        (await this.prisma.deliveryZone.findFirst({
          where: { isDefault: true },
          include: { rules: true },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in DeliveryRepository.findDefault');
      return null;
    }
  }

  /** Which zone, if any, already claims each of these places. */
  async findConflictingRules(rules: RuleSpec[]): Promise<DeliveryZoneRule[] | null> {
    if (rules.length === 0) {
      return [];
    }

    try {
      return await this.prisma.deliveryZoneRule.findMany({
        where: { OR: rules.map((rule) => ({ ...rule })) },
      });
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in DeliveryRepository.findConflictingRules',
      );
      return null;
    }
  }

  async findAll(activeOnly: boolean): Promise<ZoneWithRules[] | null> {
    try {
      return await this.prisma.deliveryZone.findMany({
        where: activeOnly ? { isActive: true } : {},
        include: { rules: true },
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in DeliveryRepository.findAll');
      return null;
    }
  }
}

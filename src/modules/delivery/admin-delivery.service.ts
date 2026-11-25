import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DeliverySlot } from '../../infra/prisma/prisma-client';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AuthService } from '../auth/auth.service';
import { AdminAuditActions, AdminAuditEntities } from '../admin/admin.constants';
import { AuditLogWriteData } from '../admin/audit-log.repository';
import { GeoService } from '../geo/geo.service';
import { DeliveryConstants, DeliveryMessages } from './delivery.constants';
import { DeliveryMapper } from './delivery.mapper';
import { DeliveryRepository, RuleSpec, ZoneWithRules } from './delivery.repository';
import { DeliveryZoneDto, UpsertZoneDto, ZoneRuleDto } from './dto/delivery.dto';
import { DeliverySlotDto, UpsertSlotDto } from './dto/slot.dto';

/**
 * Managing delivery pricing.
 *
 * Two rules are enforced here rather than trusted to whoever fills the form. Every place named
 * in a rule is validated against the geography dataset, because a typo'd district would never
 * match and would quietly bill everyone there the default rate. And a zone claiming a place
 * another zone already holds is refused, because two matching rules of equal specificity make
 * the price depend on row order.
 */
@Injectable()
export class AdminDeliveryService {
  constructor(
    private readonly repository: DeliveryRepository,
    private readonly geo: GeoService,
    private readonly authService: AuthService,
    @InjectPinoLogger(AdminDeliveryService.name) private readonly logger: PinoLogger,
  ) {}

  async list(activeOnly: boolean): Promise<ServiceResponse<DeliveryZoneDto[]>> {
    try {
      const zones = await this.repository.findAll(activeOnly);

      if (zones === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.Unavailable);
      }

      return serviceOk(zones.map((zone) => DeliveryMapper.toZoneDto(zone)));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminDeliveryService.list');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async create(
    actor: AuthenticatedUser,
    dto: UpsertZoneDto,
  ): Promise<ServiceResponse<DeliveryZoneDto>> {
    try {
      const staff = await this.authService.resolveActiveUserId(actor);
      if (!staff.ok) {
        return staff;
      }

      const rules = AdminDeliveryService.toRules(dto.rules ?? []);

      const guard = await this.validate(rules, dto.isDefault ?? false, null);
      if (guard) {
        return guard;
      }

      const created = await this.repository.createAudited(
        AdminDeliveryService.toWriteData(dto),
        rules,
        (zone) =>
          AdminDeliveryService.audit(staff.data, actor, AdminAuditActions.ZoneCreated, zone, null),
      );

      if (!created) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.AuditTrailUnavailable);
      }

      return serviceOk(DeliveryMapper.toZoneDto(created));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminDeliveryService.create');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpsertZoneDto,
  ): Promise<ServiceResponse<DeliveryZoneDto>> {
    try {
      const staff = await this.authService.resolveActiveUserId(actor);
      if (!staff.ok) {
        return staff;
      }

      const existing = await this.repository.findById(id);

      if (existing === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.Unavailable);
      }

      if (existing === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, DeliveryConstants.ZoneResourceName),
        );
      }

      const rules = dto.rules ? AdminDeliveryService.toRules(dto.rules) : null;

      const guard = await this.validate(rules ?? [], dto.isDefault ?? false, id);
      if (guard) {
        return guard;
      }

      const updated = await this.repository.updateAudited(
        id,
        AdminDeliveryService.toWriteData(dto),
        rules,
        (zone) =>
          AdminDeliveryService.audit(
            staff.data,
            actor,
            AdminAuditActions.ZoneUpdated,
            zone,
            existing,
          ),
      );

      if (!updated) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.AuditTrailUnavailable);
      }

      return serviceOk(DeliveryMapper.toZoneDto(updated));
    } catch (error) {
      this.logger.error(
        { err: error, zoneId: id },
        'Exception occurred in AdminDeliveryService.update',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Every reason a zone's rules cannot be accepted, checked before anything is written. */
  private async validate(
    rules: RuleSpec[],
    isDefault: boolean,
    excludeZoneId: string | null,
  ): Promise<ServiceResponse<never> | null> {
    const shape = AdminDeliveryService.assertWellFormed(rules);
    if (shape) {
      return shape;
    }

    const known = this.assertPlacesExist(rules);
    if (known) {
      return known;
    }

    const overlap = await this.assertNoOverlap(rules, excludeZoneId);
    if (overlap) {
      return overlap;
    }

    return isDefault ? await this.assertNoOtherDefault(excludeZoneId) : null;
  }

  /** A rule must name its parents: a unit without a district cannot be resolved. */
  private static assertWellFormed(rules: RuleSpec[]): ServiceResponse<never> | null {
    if (rules.some((rule) => rule.unit && !rule.district)) {
      return serviceFail(HttpStatus.BAD_REQUEST, DeliveryMessages.UnitNeedsDistrict);
    }

    if (rules.some((rule) => rule.district && !rule.division)) {
      return serviceFail(HttpStatus.BAD_REQUEST, DeliveryMessages.DistrictNeedsDivision);
    }

    return null;
  }

  /** Every named place must exist in the geography dataset. */
  private assertPlacesExist(rules: RuleSpec[]): ServiceResponse<never> | null {
    const unknown = rules.find((rule) => !this.placeExists(rule));

    if (!unknown) {
      return null;
    }

    this.logger.warn({ ...unknown }, 'Delivery rule named a place not in the geo dataset');
    return serviceFail(HttpStatus.BAD_REQUEST, DeliveryMessages.UnknownPlace);
  }

  private placeExists(rule: RuleSpec): boolean {
    if (rule.unit && rule.district) {
      return this.geo.validateChain(rule.division, rule.district, rule.unit).ok;
    }

    if (rule.district) {
      return this.geo.validateDistrict(rule.division, rule.district).ok;
    }

    return this.geo.validateDivision(rule.division).ok;
  }

  /** No place may belong to two zones: equal specificity makes the price row-order dependent. */
  private async assertNoOverlap(
    rules: RuleSpec[],
    excludeZoneId: string | null,
  ): Promise<ServiceResponse<never> | null> {
    const conflicts = await this.repository.findConflictingRules(rules);

    if (conflicts === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.Unavailable);
    }

    const foreign = conflicts.find((rule) => rule.zoneId !== excludeZoneId);

    return foreign ? serviceFail(HttpStatus.CONFLICT, DeliveryMessages.PlaceAlreadyZoned) : null;
  }

  /** Exactly one default, so an unmatched address has one unambiguous fee. */
  private async assertNoOtherDefault(
    excludeZoneId: string | null,
  ): Promise<ServiceResponse<never> | null> {
    const current = await this.repository.findDefault();

    if (current === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.Unavailable);
    }

    return current && current.id !== excludeZoneId
      ? serviceFail(HttpStatus.CONFLICT, DeliveryMessages.DefaultZoneExists)
      : null;
  }

  private static toRules(rules: ZoneRuleDto[]): RuleSpec[] {
    return rules.map((rule) => ({
      division: rule.division,
      district: rule.district ?? null,
      unit: rule.unit ?? null,
    }));
  }

  private static toWriteData(dto: UpsertZoneDto) {
    return {
      nameEn: dto.nameEn,
      nameBn: dto.nameBn ?? null,
      feePoysha: BigInt(dto.feePoysha),
      freeAbovePoysha:
        dto.freeAbovePoysha === undefined || dto.freeAbovePoysha === null
          ? null
          : BigInt(dto.freeAbovePoysha),
      isDefault: dto.isDefault ?? false,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };
  }

  private static audit(
    actorId: string,
    actor: AuthenticatedUser,
    action: string,
    after: ZoneWithRules,
    before: ZoneWithRules | null,
  ): AuditLogWriteData {
    return {
      actorId,
      actorEmail: actor.email ?? null,
      actorRole: actor.role,
      action,
      entityType: AdminAuditEntities.DeliveryZone,
      entityId: after.id,
      before: AdminDeliveryService.toJson(before),
      after: AdminDeliveryService.toJson(after),
      requestId: null,
    };
  }

  /** Explicit BigInt replacer rather than the global hook main.ts installs. */
  private static toJson(zone: ZoneWithRules | null): AuditLogWriteData['before'] {
    if (!zone) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(zone, (_key, item: unknown) =>
        typeof item === 'bigint' ? Number(item) : item,
      ),
    ) as AuditLogWriteData['before'];
  }

  async listSlots(): Promise<ServiceResponse<DeliverySlotDto[]>> {
    try {
      const slots = await this.repository.findAllSlots();

      if (slots === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.Unavailable);
      }

      return serviceOk(slots.map((slot) => AdminDeliveryService.toSlotDto(slot)));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminDeliveryService.listSlots');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async createSlot(
    actor: AuthenticatedUser,
    dto: UpsertSlotDto,
  ): Promise<ServiceResponse<DeliverySlotDto>> {
    try {
      const staff = await this.authService.resolveActiveUserId(actor);
      if (!staff.ok) {
        return staff;
      }

      const invalid = AdminDeliveryService.assertSlotCoherent(dto);
      if (invalid) {
        return invalid;
      }

      const created = await this.repository.createSlotAudited(
        AdminDeliveryService.toSlotWriteData(dto),
        (slot) =>
          AdminDeliveryService.auditSlot(staff.data, actor, AdminAuditActions.SlotCreated, slot),
      );

      if (!created) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.AuditTrailUnavailable);
      }

      return serviceOk(AdminDeliveryService.toSlotDto(created));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminDeliveryService.createSlot');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateSlot(
    actor: AuthenticatedUser,
    id: string,
    dto: UpsertSlotDto,
  ): Promise<ServiceResponse<DeliverySlotDto>> {
    try {
      const staff = await this.authService.resolveActiveUserId(actor);
      if (!staff.ok) {
        return staff;
      }

      const invalid = AdminDeliveryService.assertSlotCoherent(dto);
      if (invalid) {
        return invalid;
      }

      const updated = await this.repository.updateSlotAudited(
        id,
        AdminDeliveryService.toSlotWriteData(dto),
        (slot) =>
          AdminDeliveryService.auditSlot(staff.data, actor, AdminAuditActions.SlotUpdated, slot),
      );

      if (!updated) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.AuditTrailUnavailable);
      }

      return serviceOk(AdminDeliveryService.toSlotDto(updated));
    } catch (error) {
      this.logger.error(
        { err: error, slotId: id },
        'Exception occurred in AdminDeliveryService.updateSlot',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * A window that cannot be delivered.
   *
   * The database enforces the same things, but a 400 naming the problem beats a 500 from a
   * constraint violation the operator cannot read.
   */
  private static assertSlotCoherent(dto: UpsertSlotDto): ServiceResponse<never> | null {
    if (dto.endMinute <= dto.startMinute) {
      return serviceFail(HttpStatus.BAD_REQUEST, DeliveryMessages.SlotWindowInverted);
    }

    // A cutoff longer than the window's own start means orders close before the previous day
    // ends, which is a same-day window nobody can ever book.
    if ((dto.cutoffMinutes ?? 0) > dto.startMinute) {
      return serviceFail(HttpStatus.BAD_REQUEST, DeliveryMessages.SlotCutoffTooEarly);
    }

    return null;
  }

  private static toSlotWriteData(dto: UpsertSlotDto) {
    return {
      warehouseId: dto.warehouseId,
      labelEn: dto.labelEn,
      labelBn: dto.labelBn ?? null,
      startMinute: dto.startMinute,
      endMinute: dto.endMinute,
      daysOfWeek: dto.daysOfWeek,
      capacity: dto.capacity,
      cutoffMinutes: dto.cutoffMinutes ?? 0,
      supportsPerishable: dto.supportsPerishable ?? false,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };
  }

  private static toSlotDto(slot: DeliverySlot): DeliverySlotDto {
    return {
      id: slot.id,
      warehouseId: slot.warehouseId,
      labelEn: slot.labelEn,
      labelBn: slot.labelBn,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      daysOfWeek: slot.daysOfWeek,
      capacity: slot.capacity,
      cutoffMinutes: slot.cutoffMinutes,
      supportsPerishable: slot.supportsPerishable,
      isActive: slot.isActive,
      sortOrder: slot.sortOrder,
    };
  }

  private static auditSlot(
    actorId: string,
    actor: AuthenticatedUser,
    action: string,
    slot: DeliverySlot,
  ): AuditLogWriteData {
    return {
      actorId,
      actorEmail: actor.email ?? null,
      actorRole: actor.role,
      action,
      entityType: AdminAuditEntities.DeliverySlot,
      entityId: slot.id,
      before: undefined,
      after: JSON.parse(JSON.stringify(slot)) as AuditLogWriteData['after'],
      requestId: null,
    };
  }
}

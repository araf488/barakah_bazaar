import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Prisma, Warehouse } from '../../infra/prisma/prisma-client';
import { AuditLogWriteData } from '../admin/audit-log.repository';
import { AuthService } from '../auth/auth.service';
import { GeoService } from '../geo/geo.service';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseDto,
  WarehouseLifecycleDto,
  WarehouseQueryDto,
} from './dto/warehouse.dto';
import {
  InventoryAuditActions,
  InventoryConstants,
  InventoryMessages,
} from './inventory.constants';
import {
  DeactivationResult,
  InventoryRepository,
  LastColdCapableRefusal,
  ReactivationResult,
  StorageEditResult,
  WarehouseAuditBuilder,
  WarehouseResult,
} from './inventory.repository';

/**
 * Warehouses: the places stock sits.
 *
 * A hub's address is validated against the same vendored geography as a customer address.
 * Delivery routing has to compare the two, and it cannot do that if a hub is filed under a
 * district that does not exist.
 */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly geoService: GeoService,
    private readonly authService: AuthService,
    @InjectPinoLogger(WarehouseService.name) private readonly logger: PinoLogger,
  ) {}

  async listWarehouses(query: WarehouseQueryDto): Promise<ServiceResponse<WarehouseDto[]>> {
    try {
      const warehouses = await this.repository.listWarehouses(query.includeInactive === true);

      if (warehouses === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(warehouses.map((warehouse) => WarehouseService.toDto(warehouse)));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in WarehouseService.listWarehouses');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async createWarehouse(
    user: AuthenticatedUser,
    dto: CreateWarehouseDto,
  ): Promise<ServiceResponse<WarehouseDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(user);
      if (!actor.ok) {
        return actor;
      }

      const codeFree = await this.assertCodeFree(dto.code);
      if (!codeFree.ok) {
        return codeFree;
      }

      const geography = this.geoService.validateChain(
        dto.division,
        dto.district,
        dto.unit,
        dto.area ?? null,
      );
      if (!geography.ok) {
        return geography;
      }

      const created = await this.repository.createWarehouse(
        WarehouseService.toCreateInput(dto),
        (warehouse) =>
          WarehouseService.auditRow(actor.data, user, {
            action: InventoryAuditActions.WarehouseCreated,
            entityId: warehouse.id,
            after: warehouse,
          }),
      );

      return WarehouseService.written(created);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in WarehouseService.createWarehouse');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateWarehouse(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateWarehouseDto,
  ): Promise<ServiceResponse<WarehouseDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findWarehouseById(id);
      if (!existing) {
        return WarehouseService.missing(existing);
      }

      const guard = await this.guardUpdate(existing, dto);
      if (!guard.ok) {
        return guard;
      }

      if (dto.storageTypes !== undefined) {
        return WarehouseService.toStorageEditResponse(
          await this.repository.updateWarehouseStorage(
            id,
            WarehouseService.toUpdateInput(dto),
            dto.storageTypes,
            WarehouseService.lifecycleAudit(
              actor.data,
              user,
              InventoryAuditActions.WarehouseUpdated,
            ),
          ),
        );
      }

      const updated = await this.repository.updateWarehouse(
        id,
        WarehouseService.toUpdateInput(dto),
        (warehouse) =>
          WarehouseService.auditRow(actor.data, user, {
            action: InventoryAuditActions.WarehouseUpdated,
            entityId: warehouse.id,
            before: existing,
            after: warehouse,
          }),
      );

      return WarehouseService.written(updated);
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in WarehouseService.updateWarehouse',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Takes a hub out of service.
   *
   * Every refusal is decided inside the repository transaction, under the lifecycle lock, so a
   * concurrent receipt, deactivation or storage edit cannot slip past it. In priority order:
   * the hub still holds stock (those units would vanish from every stock screen while still on a
   * shelf), it is the last active hub, or it is the last active hub able to hold CHILLED or
   * FROZEN goods. Deactivating an already-inactive hub is idempotent and writes nothing.
   */
  async deactivateWarehouse(
    user: AuthenticatedUser,
    id: string,
  ): Promise<ServiceResponse<WarehouseLifecycleDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findWarehouseById(id);
      if (!existing) {
        return WarehouseService.missing(existing);
      }

      const result = await this.repository.deactivateWarehouse(
        id,
        WarehouseService.lifecycleAudit(
          actor.data,
          user,
          InventoryAuditActions.WarehouseDeactivated,
        ),
      );

      return WarehouseService.toLifecycleResponse(result);
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in WarehouseService.deactivateWarehouse',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Puts a hub back into service. Never refused: more active hubs only loosen the lifecycle
   * rules. Reactivating an active hub is idempotent and writes nothing.
   */
  async reactivateWarehouse(
    user: AuthenticatedUser,
    id: string,
  ): Promise<ServiceResponse<WarehouseLifecycleDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findWarehouseById(id);
      if (!existing) {
        return WarehouseService.missing(existing);
      }

      const result = await this.repository.reactivateWarehouse(
        id,
        WarehouseService.lifecycleAudit(
          actor.data,
          user,
          InventoryAuditActions.WarehouseReactivated,
        ),
      );

      return WarehouseService.toLifecycleResponse(result);
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in WarehouseService.reactivateWarehouse',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  private async guardUpdate(
    existing: Warehouse,
    dto: UpdateWarehouseDto,
  ): Promise<ServiceResponse<void>> {
    if (dto.code !== undefined && dto.code !== existing.code) {
      const free = await this.assertCodeFree(dto.code);
      if (!free.ok) {
        return free;
      }
    }

    const touchesGeography =
      dto.division !== undefined ||
      dto.district !== undefined ||
      dto.unit !== undefined ||
      dto.area !== undefined;

    if (!touchesGeography) {
      return serviceOk<void>(undefined);
    }

    return this.geoService.validateChain(
      dto.division ?? existing.division,
      dto.district ?? existing.district,
      dto.unit ?? existing.upazila,
      dto.area !== undefined ? dto.area : existing.area,
    );
  }

  private async assertCodeFree(code: string): Promise<ServiceResponse<void>> {
    const clash = await this.repository.findWarehouseByCode(code);

    if (clash === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (clash !== undefined) {
      return serviceFail(
        HttpStatus.CONFLICT,
        formatMessage(InventoryMessages.WarehouseCodeTakenTemplate, code),
      );
    }

    return serviceOk<void>(undefined);
  }

  // ── Mapping ───────────────────────────────────────────────────────────────

  private static toCreateInput(dto: CreateWarehouseDto): Prisma.WarehouseCreateInput {
    return {
      code: dto.code,
      nameEn: dto.nameEn,
      nameBn: dto.nameBn ?? null,
      division: dto.division,
      district: dto.district,
      // The API says `unit`; the column is `upazila`, whose name predates city coverage.
      upazila: dto.unit,
      area: dto.area ?? null,
      addressLine: dto.addressLine,
      postCode: dto.postCode ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      serviceRadiusKm: dto.serviceRadiusKm ?? null,
      ...(dto.storageTypes ? { storageTypes: dto.storageTypes } : {}),
    };
  }

  private static toUpdateInput(dto: UpdateWarehouseDto): Prisma.WarehouseUpdateInput {
    return {
      ...(dto.code === undefined ? {} : { code: dto.code }),
      ...(dto.nameEn === undefined ? {} : { nameEn: dto.nameEn }),
      ...(dto.nameBn === undefined ? {} : { nameBn: dto.nameBn }),
      ...(dto.division === undefined ? {} : { division: dto.division }),
      ...(dto.district === undefined ? {} : { district: dto.district }),
      ...(dto.unit === undefined ? {} : { upazila: dto.unit }),
      ...(dto.area === undefined ? {} : { area: dto.area }),
      ...(dto.addressLine === undefined ? {} : { addressLine: dto.addressLine }),
      ...(dto.postCode === undefined ? {} : { postCode: dto.postCode }),
      ...(dto.latitude === undefined ? {} : { latitude: dto.latitude }),
      ...(dto.longitude === undefined ? {} : { longitude: dto.longitude }),
      ...(dto.serviceRadiusKm === undefined ? {} : { serviceRadiusKm: dto.serviceRadiusKm }),
      ...(dto.storageTypes === undefined ? {} : { storageTypes: dto.storageTypes }),
    };
  }

  private static toDto(warehouse: Warehouse): WarehouseDto {
    return {
      id: warehouse.id,
      code: warehouse.code,
      nameEn: warehouse.nameEn,
      nameBn: warehouse.nameBn,
      division: warehouse.division,
      district: warehouse.district,
      unit: warehouse.upazila,
      area: warehouse.area,
      addressLine: warehouse.addressLine,
      postCode: warehouse.postCode,
      latitude: warehouse.latitude,
      longitude: warehouse.longitude,
      serviceRadiusKm: warehouse.serviceRadiusKm,
      storageTypes: warehouse.storageTypes,
      isActive: warehouse.isActive,
    };
  }

  private static auditRow(
    actorId: string,
    user: AuthenticatedUser,
    entry: { action: string; entityId: string; before?: unknown; after?: unknown },
  ): AuditLogWriteData {
    return {
      actorId,
      actorEmail: user.email ?? null,
      actorRole: user.role,
      action: entry.action,
      entityType: InventoryConstants.WarehouseResourceName,
      entityId: entry.entityId,
      before: WarehouseService.toJson(entry.before),
      after: WarehouseService.toJson(entry.after),
      requestId: null,
    };
  }

  /** Audit builder for the locked paths: `before` is the row read under the lifecycle lock. */
  private static lifecycleAudit(
    actorId: string,
    user: AuthenticatedUser,
    action: string,
  ): WarehouseAuditBuilder {
    return (before, after) =>
      WarehouseService.auditRow(actorId, user, { action, entityId: after.id, before, after });
  }

  private static toJson(value: unknown): AuditLogWriteData['before'] {
    if (value === undefined || value === null) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? Number(item) : item,
      ),
    ) as AuditLogWriteData['before'];
  }

  private static written(result: Warehouse | null): ServiceResponse<WarehouseDto> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    return serviceOk(WarehouseService.toDto(result));
  }

  private static toLifecycleResponse(
    result: DeactivationResult | ReactivationResult,
  ): ServiceResponse<WarehouseLifecycleDto> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    switch (result.kind) {
      case 'holds-stock':
        return serviceFail(HttpStatus.CONFLICT, InventoryMessages.WarehouseHoldsStock);
      case 'last-active':
        return serviceFail(HttpStatus.CONFLICT, InventoryMessages.LastActiveWarehouse);
      case 'last-cold-capable':
        return WarehouseService.lastColdCapable(result);
      default:
        return serviceOk({
          ...WarehouseService.toDto(result.warehouse),
          activeWarehousesRemaining: result.activeRemaining,
        });
    }
  }

  private static toStorageEditResponse(result: StorageEditResult): ServiceResponse<WarehouseDto> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (result.kind === 'last-cold-capable') {
      return WarehouseService.lastColdCapable(result);
    }

    return serviceOk(WarehouseService.toDto(result.warehouse));
  }

  private static lastColdCapable<T>(refusal: LastColdCapableRefusal): ServiceResponse<T> {
    return serviceFail(
      HttpStatus.CONFLICT,
      formatMessage(InventoryMessages.LastColdCapableWarehouseTemplate, refusal.storageType),
    );
  }

  private static missing<T>(result: WarehouseResult): ServiceResponse<T> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    return serviceFail(
      HttpStatus.NOT_FOUND,
      formatMessage(ErrorMessageTemplates.NotFound, InventoryConstants.WarehouseResourceName),
    );
  }
}

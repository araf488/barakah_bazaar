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
  WarehouseQueryDto,
} from './dto/warehouse.dto';
import {
  InventoryAuditActions,
  InventoryConstants,
  InventoryMessages,
} from './inventory.constants';
import { InventoryRepository, WarehouseResult } from './inventory.repository';

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
   * Refused while it still holds stock: those units would become invisible to every stock
   * screen while remaining physically on a shelf, which is how inventory quietly stops
   * matching reality.
   */
  async deactivateWarehouse(
    user: AuthenticatedUser,
    id: string,
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

      const held = await this.repository.countStockInWarehouse(id);

      if (held === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (held > 0) {
        return serviceFail(HttpStatus.CONFLICT, InventoryMessages.WarehouseHoldsStock);
      }

      const updated = await this.repository.updateWarehouse(id, { isActive: false }, (warehouse) =>
        WarehouseService.auditRow(actor.data, user, {
          action: InventoryAuditActions.WarehouseDeactivated,
          entityId: warehouse.id,
          before: existing,
          after: warehouse,
        }),
      );

      return WarehouseService.written(updated);
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in WarehouseService.deactivateWarehouse',
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

  private static missing(result: WarehouseResult): ServiceResponse<WarehouseDto> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    return serviceFail(
      HttpStatus.NOT_FOUND,
      formatMessage(ErrorMessageTemplates.NotFound, InventoryConstants.WarehouseResourceName),
    );
  }
}

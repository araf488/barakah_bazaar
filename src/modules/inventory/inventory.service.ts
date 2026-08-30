import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages, formatMessage } from '../../common/constants/error-messages.constants';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { StockMovementReason } from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import { AdminCatalogRepository } from '../admin/admin-catalog.repository';
import {
  AdjustStockDto,
  ReceiveStockDto,
  StockLineDto,
  StockMovementDto,
  StockQueryDto,
} from './dto/inventory.dto';
import { InventoryMessages } from './inventory.constants';
import { InventoryRepository, StockRow } from './inventory.repository';

const MS_PER_DAY = 86_400_000;

/**
 * Stock levels, receipts and corrections.
 *
 * Two rules do the real work here, and both exist because stock is money:
 * a correction always carries a reason, and stock promised to a checkout in progress may not
 * be removed by a warehouse adjustment. Postgres CHECK constraints stop a quantity going
 * negative; this service exists to turn that refusal into something a picker can act on.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly catalog: AdminCatalogRepository,
    private readonly authService: AuthService,
    @InjectPinoLogger(InventoryService.name) private readonly logger: PinoLogger,
  ) {}

  async listStock(
    query: StockQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<StockLineDto>>> {
    try {
      const page = await this.repository.findPage(query);

      if (page === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const horizon =
        query.expiringWithinDays === undefined
          ? null
          : new Date(Date.now() + query.expiringWithinDays * MS_PER_DAY);

      const lines = page.items
        .map((row) =>
          InventoryService.toLine(
            row,
            page.nextExpiry.get(InventoryRepository.key(row.warehouseId, row.variantId)) ?? null,
          ),
        )
        .filter((line) => !query.lowStockOnly || line.isLow)
        .filter(
          (line) =>
            horizon === null || (line.nextExpiryAt !== null && line.nextExpiryAt <= horizon),
        );

      // The filters run after paging, so the total describes the unfiltered set. Reported as
      // the page length when a filter is on, rather than claiming a total that would not
      // match what the caller can see.
      const total = query.lowStockOnly || horizon !== null ? lines.length : page.total;

      return serviceOk(PaginatedResponseDto.of(lines, total, query.page, query.limit));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryService.listStock');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async receiveStock(
    user: AuthenticatedUser,
    dto: ReceiveStockDto,
  ): Promise<ServiceResponse<StockMovementDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(user);
      if (!actor.ok) {
        return actor;
      }

      const guard = await this.guardReceipt(dto);
      if (!guard.ok) {
        return guard;
      }

      const batch = await this.repository.receive({
        warehouseId: dto.warehouseId,
        variantId: dto.variantId,
        quantity: dto.quantity,
        batchCode: dto.batchCode ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        unitCostPoysha:
          dto.unitCostPoysha === undefined || dto.unitCostPoysha === null
            ? null
            : BigInt(dto.unitCostPoysha),
        note: dto.note ?? null,
        actorId: actor.data,
      });

      if (batch === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk({
        id: batch.id,
        delta: dto.quantity,
        reason: StockMovementReason.RECEIPT,
        note: dto.note ?? null,
        actorId: actor.data,
        referenceType: null,
        referenceId: null,
        createdAt: batch.createdAt,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryService.receiveStock');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async adjustStock(
    user: AuthenticatedUser,
    dto: AdjustStockDto,
  ): Promise<ServiceResponse<StockLineDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(user);
      if (!actor.ok) {
        return actor;
      }

      const stock = await this.repository.findStock(dto.warehouseId, dto.variantId);

      if (stock === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (stock === undefined) {
        return serviceFail(HttpStatus.NOT_FOUND, InventoryMessages.NoStockLine);
      }

      const guard = InventoryService.guardAdjustment(
        stock.quantityOnHand,
        stock.quantityReserved,
        dto.delta,
      );
      if (!guard.ok) {
        return guard;
      }

      const updated = await this.repository.adjust({
        warehouseId: dto.warehouseId,
        variantId: dto.variantId,
        delta: dto.delta,
        reason: dto.reason,
        note: dto.note,
        actorId: actor.data,
      });

      if (updated === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const page = await this.repository.findPage(
        Object.assign(new StockQueryDto(), { warehouseId: dto.warehouseId, page: 1, limit: 100 }),
      );
      const row = page?.items.find((item) => item.variantId === dto.variantId);

      if (!row) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(
        InventoryService.toLine(
          row,
          page?.nextExpiry.get(InventoryRepository.key(dto.warehouseId, dto.variantId)) ?? null,
        ),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryService.adjustStock');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async listMovements(
    warehouseId: string,
    variantId: string,
  ): Promise<ServiceResponse<StockMovementDto[]>> {
    try {
      const movements = await this.repository.listMovements(warehouseId, variantId, 100);

      if (movements === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(
        movements.map((movement) => ({
          id: movement.id,
          delta: movement.delta,
          reason: movement.reason,
          note: movement.note,
          actorId: movement.actorId,
          referenceType: movement.referenceType,
          referenceId: movement.referenceId,
          createdAt: movement.createdAt,
        })),
      );
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId, variantId },
        'Exception occurred in InventoryService.listMovements',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  private async guardReceipt(dto: ReceiveStockDto): Promise<ServiceResponse<void>> {
    const variant = await this.catalog.findVariantById(dto.variantId);

    if (variant === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (variant === undefined || !variant.isActive) {
      return serviceFail(HttpStatus.BAD_REQUEST, InventoryMessages.VariantUnavailable);
    }

    const product = await this.catalog.findProductById(variant.productId);

    if (!product) {
      return serviceFail(HttpStatus.BAD_REQUEST, InventoryMessages.VariantUnavailable);
    }

    // A perishable batch with no expiry cannot be picked first-expiry-first-out, which is the
    // one thing this module exists to do.
    if (product.isPerishable && !dto.expiresAt) {
      return serviceFail(HttpStatus.BAD_REQUEST, InventoryMessages.ExpiryRequired);
    }

    if (dto.expiresAt && new Date(dto.expiresAt).getTime() <= Date.now()) {
      return serviceFail(HttpStatus.BAD_REQUEST, InventoryMessages.ExpiryInPast);
    }

    return serviceOk<void>(undefined);
  }

  /**
   * Refuses a removal that would go below zero, or that would eat into reserved stock.
   *
   * The database would refuse the first anyway; catching it here turns a constraint violation
   * into a message naming the number the picker can actually see on the shelf. The reserved
   * check has no database equivalent: those units are physically present, which is exactly
   * why an adjustment would otherwise take them and oversell a checkout in progress.
   */
  private static guardAdjustment(
    onHand: number,
    reserved: number,
    delta: number,
  ): ServiceResponse<void> {
    if (delta >= 0) {
      return serviceOk<void>(undefined);
    }

    const removing = Math.abs(delta);

    if (removing > onHand) {
      return serviceFail(
        HttpStatus.CONFLICT,
        formatMessage(InventoryMessages.InsufficientStockTemplate, String(onHand)),
      );
    }

    if (removing > onHand - reserved) {
      return serviceFail(
        HttpStatus.CONFLICT,
        formatMessage(InventoryMessages.ReservedStockTemplate, String(reserved), String(onHand)),
      );
    }

    return serviceOk<void>(undefined);
  }

  private static toLine(row: StockRow, nextExpiryAt: Date | null): StockLineDto {
    const available = row.quantityOnHand - row.quantityReserved;

    return {
      variantId: row.variantId,
      sku: row.variant.sku,
      productNameEn: row.variant.product.nameEn,
      variantNameEn: row.variant.nameEn,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse.code,
      quantityOnHand: row.quantityOnHand,
      quantityReserved: row.quantityReserved,
      quantityAvailable: available,
      reorderLevel: row.reorderLevel,
      isLow: row.reorderLevel !== null && available <= row.reorderLevel,
      nextExpiryAt,
    };
  }
}

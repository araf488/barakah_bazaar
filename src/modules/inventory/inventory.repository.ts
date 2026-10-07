import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  Inventory,
  InventoryBatch,
  Prisma,
  StockMovement,
  StockMovementReason,
  StorageType,
  Warehouse,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { consumeFefo } from './batch-consumption';
import { AuditLogRepository, AuditLogWriteData } from '../admin/audit-log.repository';
import { StockQueryDto } from './dto/inventory.dto';
import { InventoryConstants } from './inventory.constants';

/** `undefined` = no such row; `null` = the query failed. */
export type StockResult = Inventory | null | undefined;
export type WarehouseResult = Warehouse | null | undefined;

/** Builds a hub lifecycle audit row from the row read under the lock and the row written. */
export type WarehouseAuditBuilder = (before: Warehouse, after: Warehouse) => AuditLogWriteData;

/** A lifecycle change that went through, or was already in place. */
export interface WarehouseLifecycleChange<TKind extends 'deactivated' | 'reactivated'> {
  readonly kind: TKind;
  readonly warehouse: Warehouse;
  /** Active hubs after the change. */
  readonly activeRemaining: number;
}

/** The hub is the only active one able to hold `storageType`; nothing was written. */
export interface LastColdCapableRefusal {
  readonly kind: 'last-cold-capable';
  readonly storageType: StorageType;
}

/**
 * `null` = the database failed. Every other non-`deactivated` kind is a refusal with nothing
 * written: `holds-stock` outranks `last-active`, which outranks `last-cold-capable`.
 */
export type DeactivationResult =
  | WarehouseLifecycleChange<'deactivated'>
  | { readonly kind: 'holds-stock' }
  | { readonly kind: 'last-active' }
  | LastColdCapableRefusal
  | null;

/** `null` = the database failed. Reactivation has no refusals. */
export type ReactivationResult = WarehouseLifecycleChange<'reactivated'> | null;

/** `null` = the database failed; `last-cold-capable` = refused, nothing written. */
export type StorageEditResult =
  { readonly kind: 'updated'; readonly warehouse: Warehouse } | LastColdCapableRefusal | null;

/**
 * `null` = the database failed; `warehouse-inactive` = the hub was out of service when the
 * receipt took the lifecycle lock, so nothing was written.
 */
export type ReceiptResult =
  | { readonly kind: 'received'; readonly batch: InventoryBatch }
  | { readonly kind: 'warehouse-inactive' }
  | null;

const stockInclude = {
  warehouse: { select: { id: true, code: true } },
  variant: {
    select: { id: true, sku: true, nameEn: true, product: { select: { nameEn: true } } },
  },
} satisfies Prisma.InventoryInclude;

export type StockRow = Prisma.InventoryGetPayload<{ include: typeof stockInclude }>;

export interface StockPage {
  items: StockRow[];
  total: number;
  /** Earliest live batch expiry per `warehouseId:variantId`, for the rows on this page. */
  nextExpiry: Map<string, Date>;
}

export interface ReceiptData {
  warehouseId: string;
  variantId: string;
  quantity: number;
  batchCode: string | null;
  expiresAt: Date | null;
  unitCostPoysha: bigint | null;
  note: string | null;
  actorId: string;
}

export interface AdjustmentData {
  warehouseId: string;
  variantId: string;
  delta: number;
  reason: StockMovementReason;
  note: string;
  actorId: string;
}

/**
 * Stock persistence.
 *
 * Every quantity change writes a `StockMovement` in the SAME transaction as the change
 * itself. That is not bookkeeping politeness: without it a discrepancy is visible but
 * unexplainable, and stock is money.
 */
@Injectable()
export class InventoryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(InventoryRepository.name) private readonly logger: PinoLogger,
  ) {}

  // ── Warehouses ────────────────────────────────────────────────────────────

  async findWarehouseById(id: string): Promise<WarehouseResult> {
    try {
      return (await this.prisma.warehouse.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in InventoryRepository.findWarehouseById',
      );
      return null;
    }
  }

  async findWarehouseByCode(code: string): Promise<WarehouseResult> {
    try {
      return (await this.prisma.warehouse.findUnique({ where: { code } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, code },
        'Exception occurred in InventoryRepository.findWarehouseByCode',
      );
      return null;
    }
  }

  async listWarehouses(includeInactive: boolean): Promise<Warehouse[] | null> {
    try {
      return await this.prisma.warehouse.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: { code: 'asc' },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryRepository.listWarehouses');
      return null;
    }
  }

  /** Writes a warehouse change and its audit row together. Structural edits get a trail. */
  async writeWarehouse(
    write: (tx: Prisma.TransactionClient) => Promise<Warehouse>,
    audit: (result: Warehouse) => AuditLogWriteData,
    context: Record<string, unknown>,
    method: string,
  ): Promise<Warehouse | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await write(tx);
        await this.auditLog.appendWithin(tx, audit(result));
        return result;
      });
    } catch (error) {
      this.logger.error(
        { err: error, ...context },
        `Exception occurred in InventoryRepository.${method}`,
      );
      return null;
    }
  }

  async createWarehouse(
    data: Prisma.WarehouseCreateInput,
    audit: (created: Warehouse) => AuditLogWriteData,
  ): Promise<Warehouse | null> {
    return await this.writeWarehouse(
      (tx) => tx.warehouse.create({ data }),
      audit,
      { code: data.code },
      'createWarehouse',
    );
  }

  async updateWarehouse(
    id: string,
    data: Prisma.WarehouseUpdateInput,
    audit: (updated: Warehouse) => AuditLogWriteData,
  ): Promise<Warehouse | null> {
    return await this.writeWarehouse(
      (tx) => tx.warehouse.update({ where: { id }, data }),
      audit,
      { warehouseId: id },
      'updateWarehouse',
    );
  }

  /**
   * Rewrites a hub's storage conditions as one atomic decision. Runs under the exclusive
   * lifecycle lock because dropping CHILLED or FROZEN from an active hub is refused when no other
   * active hub can hold it, and that count is only trustworthy while no deactivation or other
   * storage edit can run alongside it.
   */
  async updateWarehouseStorage(
    id: string,
    data: Prisma.WarehouseUpdateInput,
    storageTypes: readonly StorageType[],
    audit: WarehouseAuditBuilder,
  ): Promise<StorageEditResult> {
    try {
      return await this.prisma.$transaction(async (tx): Promise<StorageEditResult> => {
        await InventoryRepository.lockLifecycle(tx);
        const current = await tx.warehouse.findUniqueOrThrow({ where: { id } });
        const dropped = InventoryConstants.ColdStorageTypes.filter(
          (type) => current.storageTypes.includes(type) && !storageTypes.includes(type),
        );
        const sole = current.isActive
          ? await InventoryRepository.findSoleColdCapable(tx, id, dropped)
          : undefined;
        if (sole) {
          return { kind: 'last-cold-capable', storageType: sole };
        }
        const updated = await tx.warehouse.update({ where: { id }, data });
        await this.auditLog.appendWithin(tx, audit(current, updated));
        return { kind: 'updated', warehouse: updated };
      });
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in InventoryRepository.updateWarehouseStorage',
      );
      return null;
    }
  }

  /**
   * Deactivates a hub as one atomic decision: lock, read the hub, then refuse or write the change
   * and its audit row. Every refusal is decided inside the lock, so a concurrent deactivation,
   * storage edit or receipt cannot invalidate it. The lock is released at commit or rollback.
   */
  async deactivateWarehouse(id: string, audit: WarehouseAuditBuilder): Promise<DeactivationResult> {
    try {
      return await this.prisma.$transaction(async (tx): Promise<DeactivationResult> => {
        await InventoryRepository.lockLifecycle(tx);
        const current = await tx.warehouse.findUniqueOrThrow({ where: { id } });
        const others = await tx.warehouse.count({ where: { isActive: true, id: { not: id } } });
        if (!current.isActive) {
          // Already out of service: write nothing, so no false duplicate `warehouse.deactivated` audit row.
          return { kind: 'deactivated', warehouse: current, activeRemaining: others };
        }
        const refusal = await InventoryRepository.refuseDeactivation(tx, current, others);
        if (refusal) {
          return refusal;
        }
        const updated = await tx.warehouse.update({ where: { id }, data: { isActive: false } });
        await this.auditLog.appendWithin(tx, audit(current, updated));
        return { kind: 'deactivated', warehouse: updated, activeRemaining: others };
      });
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in InventoryRepository.deactivateWarehouse',
      );
      return null;
    }
  }

  /**
   * Puts a hub back into service under the exclusive lifecycle lock. Reactivating an active hub
   * is idempotent: nothing is written, so there is no false `warehouse.reactivated` audit row.
   */
  async reactivateWarehouse(id: string, audit: WarehouseAuditBuilder): Promise<ReactivationResult> {
    try {
      return await this.prisma.$transaction(async (tx): Promise<ReactivationResult> => {
        await InventoryRepository.lockLifecycle(tx);
        const current = await tx.warehouse.findUniqueOrThrow({ where: { id } });
        let warehouse = current;
        if (!current.isActive) {
          warehouse = await tx.warehouse.update({ where: { id }, data: { isActive: true } });
          await this.auditLog.appendWithin(tx, audit(current, warehouse));
        }
        const activeRemaining = await tx.warehouse.count({ where: { isActive: true } });
        return { kind: 'reactivated', warehouse, activeRemaining };
      });
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in InventoryRepository.reactivateWarehouse',
      );
      return null;
    }
  }

  /**
   * The EXCLUSIVE hub lifecycle lock: deactivation, reactivation and storage edits run one at a
   * time, and never while a receipt holds the shared form (see `receive`).
   *
   * `$executeRaw`, not `$queryRaw`: the lock function returns `void`, which the pg adapter cannot
   * map into a result row; `$executeRaw` never maps columns.
   */
  private static async lockLifecycle(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${InventoryConstants.WarehouseLifecycleLockKey}::bigint)`;
  }

  /**
   * Why an active hub may not be deactivated, in priority order, or `null` when it may. Stock
   * comes first: units on a shelf of an inactive hub vanish from every stock screen while still
   * physically present, whatever else is true of the hub.
   */
  private static async refuseDeactivation(
    tx: Prisma.TransactionClient,
    current: Warehouse,
    otherActive: number,
  ): Promise<Exclude<DeactivationResult, WarehouseLifecycleChange<'deactivated'>> | null> {
    const held = await tx.inventory.aggregate({
      where: { warehouseId: current.id },
      _sum: { quantityOnHand: true },
    });
    if ((held._sum.quantityOnHand ?? 0) > 0) {
      return { kind: 'holds-stock' };
    }
    if (otherActive === 0) {
      return { kind: 'last-active' };
    }
    const cold = InventoryConstants.ColdStorageTypes.filter((type) =>
      current.storageTypes.includes(type),
    );
    const sole = await InventoryRepository.findSoleColdCapable(tx, current.id, cold);
    return sole ? { kind: 'last-cold-capable', storageType: sole } : null;
  }

  /**
   * The first of `storageTypes` that no OTHER active hub can hold, or `undefined`. Shared by
   * deactivation and storage edits so the two rules cannot drift. Must run under the lock.
   */
  private static async findSoleColdCapable(
    tx: Prisma.TransactionClient,
    id: string,
    storageTypes: readonly StorageType[],
  ): Promise<StorageType | undefined> {
    // Sequential, not Promise.all: an interactive transaction is one connection.
    for (const storageType of storageTypes) {
      const capable = await tx.warehouse.count({
        where: { isActive: true, id: { not: id }, storageTypes: { has: storageType } },
      });
      if (capable === 0) {
        return storageType;
      }
    }
    return undefined;
  }

  static key(warehouseId: string, variantId: string): string {
    return `${warehouseId}:${variantId}`;
  }

  async findStock(warehouseId: string, variantId: string): Promise<StockResult> {
    try {
      return (
        (await this.prisma.inventory.findUnique({
          where: { warehouseId_variantId: { warehouseId, variantId } },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId, variantId },
        'Exception occurred in InventoryRepository.findStock',
      );
      return null;
    }
  }

  async findPage(query: StockQueryDto): Promise<StockPage | null> {
    try {
      const where: Prisma.InventoryWhereInput = query.warehouseId
        ? { warehouseId: query.warehouseId }
        : {};

      const [items, total] = await this.prisma.$transaction([
        this.prisma.inventory.findMany({
          where,
          include: stockInclude,
          orderBy: [{ quantityOnHand: 'asc' }],
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.inventory.count({ where }),
      ]);

      return { items, total, nextExpiry: await this.earliestExpiries(items) };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryRepository.findPage');
      return null;
    }
  }

  /**
   * Earliest live batch expiry for each line on the page.
   *
   * One extra query for the whole page rather than one per row — this list is the warehouse's
   * daily working screen and an N+1 here would be felt immediately.
   */
  private async earliestExpiries(rows: readonly StockRow[]): Promise<Map<string, Date>> {
    if (rows.length === 0) {
      return new Map();
    }

    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        quantity: { gt: 0 },
        expiresAt: { not: null },
        OR: rows.map((row) => ({ warehouseId: row.warehouseId, variantId: row.variantId })),
      },
      select: { warehouseId: true, variantId: true, expiresAt: true },
      orderBy: { expiresAt: 'asc' },
    });

    const earliest = new Map<string, Date>();

    batches.forEach((batch) => {
      const key = InventoryRepository.key(batch.warehouseId, batch.variantId);
      if (batch.expiresAt && !earliest.has(key)) {
        earliest.set(key, batch.expiresAt);
      }
    });

    return earliest;
  }

  /**
   * Books a delivery: one batch row, the rolling total, and the ledger entry, together.
   *
   * The upsert is safe under concurrency because `(warehouse_id, variant_id)` is unique —
   * two simultaneous receipts of the same line both land rather than one losing.
   *
   * The hub must still be in service when the write happens, not only when the service checked.
   * The transaction therefore takes the SHARED form of the hub lifecycle lock and re-reads
   * `isActive` under it. Shared locks do not block each other, so receipts still run
   * concurrently; they do block the EXCLUSIVE form a deactivation takes, so a deactivation either
   * finishes first (and this receipt sees an inactive hub) or waits until this receipt commits
   * (and then sees its stock). An inactive hub is reported as `warehouse-inactive`, not `null`,
   * so the caller answers 409 rather than 503.
   */
  async receive(data: ReceiptData): Promise<ReceiptResult> {
    try {
      return await this.prisma.$transaction(async (tx): Promise<ReceiptResult> => {
        // $executeRaw, not $queryRaw: the lock returns void, which the pg adapter cannot map.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${InventoryConstants.WarehouseLifecycleLockKey}::bigint)`;
        const hub = await tx.warehouse.findUniqueOrThrow({
          where: { id: data.warehouseId },
          select: { isActive: true },
        });
        if (!hub.isActive) {
          return { kind: 'warehouse-inactive' };
        }
        return { kind: 'received', batch: await InventoryRepository.bookReceipt(tx, data) };
      });
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: data.warehouseId, variantId: data.variantId },
        'Exception occurred in InventoryRepository.receive',
      );
      return null;
    }
  }

  /** The three writes of a receipt. Runs inside `receive`'s transaction. */
  private static async bookReceipt(
    tx: Prisma.TransactionClient,
    data: ReceiptData,
  ): Promise<InventoryBatch> {
    const batch = await tx.inventoryBatch.create({
      data: {
        warehouse: { connect: { id: data.warehouseId } },
        variant: { connect: { id: data.variantId } },
        batchCode: data.batchCode,
        quantity: data.quantity,
        receivedAt: new Date(),
        expiresAt: data.expiresAt,
        unitCostPoysha: data.unitCostPoysha,
      },
    });

    await tx.inventory.upsert({
      where: {
        warehouseId_variantId: {
          warehouseId: data.warehouseId,
          variantId: data.variantId,
        },
      },
      create: {
        warehouse: { connect: { id: data.warehouseId } },
        variant: { connect: { id: data.variantId } },
        quantityOnHand: data.quantity,
      },
      update: { quantityOnHand: { increment: data.quantity } },
    });

    await tx.stockMovement.create({
      data: {
        warehouse: { connect: { id: data.warehouseId } },
        variant: { connect: { id: data.variantId } },
        batch: { connect: { id: batch.id } },
        delta: data.quantity,
        reason: StockMovementReason.RECEIPT,
        note: data.note,
        actorId: data.actorId,
      },
    });

    return batch;
  }

  /**
   * Applies a correction, consuming batches first-expiry-first-out when removing.
   *
   * FEFO is not a preference: the oldest stock is the stock about to become unsellable, so
   * taking from anywhere else guarantees waste. A positive adjustment has no batch to belong
   * to — it is a correction of a miscount, not a delivery — so it records none.
   */
  async adjust(data: AdjustmentData): Promise<Inventory | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Consumed first, so the movements below can name the batches they came off.
        const takes =
          data.delta < 0
            ? await consumeFefo(tx, data.warehouseId, data.variantId, Math.abs(data.delta))
            : [{ batchId: null, quantity: data.delta }];

        const updated = await tx.inventory.update({
          where: {
            warehouseId_variantId: {
              warehouseId: data.warehouseId,
              variantId: data.variantId,
            },
          },
          data: { quantityOnHand: { increment: data.delta } },
        });

        // One movement per batch. The rows still sum to `data.delta`, but each names where
        // its units came from, which an aggregate row cannot.
        for (const take of takes) {
          await tx.stockMovement.create({
            data: {
              warehouse: { connect: { id: data.warehouseId } },
              variant: { connect: { id: data.variantId } },
              ...(take.batchId ? { batch: { connect: { id: take.batchId } } } : {}),
              delta: data.delta < 0 ? -take.quantity : take.quantity,
              reason: data.reason,
              note: data.note,
              actorId: data.actorId,
            },
          });
        }

        return updated;
      });
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: data.warehouseId, variantId: data.variantId },
        'Exception occurred in InventoryRepository.adjust',
      );
      return null;
    }
  }

  async listMovements(
    warehouseId: string,
    variantId: string,
    take: number,
  ): Promise<StockMovement[] | null> {
    try {
      return await this.prisma.stockMovement.findMany({
        where: { warehouseId, variantId },
        orderBy: { createdAt: 'desc' },
        take,
      });
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId, variantId },
        'Exception occurred in InventoryRepository.listMovements',
      );
      return null;
    }
  }
}

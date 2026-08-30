import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  Inventory,
  InventoryBatch,
  Prisma,
  StockMovement,
  StockMovementReason,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StockQueryDto } from './dto/inventory.dto';

/** `undefined` = no such row; `null` = the query failed. */
export type StockResult = Inventory | null | undefined;

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
    @InjectPinoLogger(InventoryRepository.name) private readonly logger: PinoLogger,
  ) {}

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
   */
  async receive(data: ReceiptData): Promise<InventoryBatch | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
      });
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: data.warehouseId, variantId: data.variantId },
        'Exception occurred in InventoryRepository.receive',
      );
      return null;
    }
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
        if (data.delta < 0) {
          await InventoryRepository.consumeBatches(tx, data);
        }

        const updated = await tx.inventory.update({
          where: {
            warehouseId_variantId: {
              warehouseId: data.warehouseId,
              variantId: data.variantId,
            },
          },
          data: { quantityOnHand: { increment: data.delta } },
        });

        await tx.stockMovement.create({
          data: {
            warehouse: { connect: { id: data.warehouseId } },
            variant: { connect: { id: data.variantId } },
            delta: data.delta,
            reason: data.reason,
            note: data.note,
            actorId: data.actorId,
          },
        });

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

  /** Draws `-delta` units off the earliest-expiring batches that still have stock. */
  private static async consumeBatches(
    tx: Prisma.TransactionClient,
    data: AdjustmentData,
  ): Promise<void> {
    let remaining = Math.abs(data.delta);

    const batches = await tx.inventoryBatch.findMany({
      where: { warehouseId: data.warehouseId, variantId: data.variantId, quantity: { gt: 0 } },
      // Nulls last: a batch with no expiry is non-perishable and can wait.
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
    });

    for (const batch of batches) {
      if (remaining <= 0) {
        break;
      }

      const taken = Math.min(batch.quantity, remaining);
      remaining -= taken;

      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: taken } },
      });
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

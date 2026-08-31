import { Prisma } from '../../infra/prisma/prisma-client';

/** How much came off one batch. */
export interface BatchTake {
  /** Null for the portion no batch covered — see `consumeFefo`. */
  readonly batchId: string | null;
  readonly quantity: number;
}

/**
 * Draws units off the earliest-expiring batches that still have stock.
 *
 * Shared by manual adjustments and by order dispatch, deliberately. They used to differ:
 * adjustments consumed batches and dispatch did not, so every sale moved
 * `inventory.quantity_on_hand` while leaving `inventory_batches.quantity` untouched. The two
 * then disagreed permanently, and expiry picking kept choosing batches that were already sold.
 *
 * Returns what came off each batch so the caller can write one stock movement per batch. That
 * is what makes "which customers received batch X" answerable, which is the whole point of
 * tracking expiry in a grocery.
 *
 * The caller supplies the transaction: batch decrements, the on-hand update and the movements
 * must all commit together or the ledger disagrees with the shelf.
 */
export async function consumeFefo(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  variantId: string,
  quantity: number,
): Promise<BatchTake[]> {
  let remaining = quantity;

  const batches = await tx.inventoryBatch.findMany({
    where: { warehouseId, variantId, quantity: { gt: 0 } },
    // Nulls last: a batch with no expiry is non-perishable and can wait.
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
  });

  const takes: BatchTake[] = [];

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

    takes.push({ batchId: batch.id, quantity: taken });
  }

  if (remaining > 0) {
    // No batch covered this much. Either the variant is not batch-tracked at all, or the
    // batch records are behind the shelf. Returned as an untraceable take rather than
    // silently dropped, so the movement ledger still sums to what actually left.
    takes.push({ batchId: null, quantity: remaining });
  }

  return takes;
}

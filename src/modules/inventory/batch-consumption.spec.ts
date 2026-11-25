import { Prisma } from '../../infra/prisma/prisma-client';
import { consumeFefo } from './batch-consumption';

const batch = (id: string, quantity: number) => ({ id, quantity });

describe('consumeFefo', () => {
  let tx: {
    inventoryBatch: { findMany: jest.Mock; update: jest.Mock };
  };

  const client = () => tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    tx = { inventoryBatch: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } };
  });

  it('asks for the earliest expiry first, with undated batches last', async () => {
    await consumeFefo(client(), 'wh-1', 'var-1', 5);

    expect(tx.inventoryBatch.findMany.mock.calls[0][0].orderBy).toEqual([
      { expiresAt: { sort: 'asc', nulls: 'last' } },
      { receivedAt: 'asc' },
    ]);
  });

  it('ignores batches that are already empty', async () => {
    await consumeFefo(client(), 'wh-1', 'var-1', 5);

    expect(tx.inventoryBatch.findMany.mock.calls[0][0].where).toEqual({
      warehouseId: 'wh-1',
      variantId: 'var-1',
      quantity: { gt: 0 },
    });
  });

  it('takes everything from one batch when it covers the whole quantity', async () => {
    tx.inventoryBatch.findMany.mockResolvedValue([batch('b1', 10)]);

    await expect(consumeFefo(client(), 'wh-1', 'var-1', 4)).resolves.toEqual([
      { batchId: 'b1', quantity: 4 },
    ]);

    expect(tx.inventoryBatch.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { quantity: { decrement: 4 } },
    });
  });

  it('spills into the next batch when the first runs out', async () => {
    tx.inventoryBatch.findMany.mockResolvedValue([batch('b1', 3), batch('b2', 10)]);

    await expect(consumeFefo(client(), 'wh-1', 'var-1', 7)).resolves.toEqual([
      { batchId: 'b1', quantity: 3 },
      { batchId: 'b2', quantity: 4 },
    ]);
  });

  it('stops once the quantity is met, leaving later batches untouched', async () => {
    tx.inventoryBatch.findMany.mockResolvedValue([
      batch('b1', 10),
      batch('b2', 10),
      batch('b3', 10),
    ]);

    const takes = await consumeFefo(client(), 'wh-1', 'var-1', 5);

    expect(takes).toEqual([{ batchId: 'b1', quantity: 5 }]);
    expect(tx.inventoryBatch.update).toHaveBeenCalledTimes(1);
  });

  it('reports an untraceable remainder rather than dropping it', async () => {
    // The ledger must still sum to what actually left the shelf, even when the batch records
    // are behind reality or the variant is not batch-tracked.
    tx.inventoryBatch.findMany.mockResolvedValue([batch('b1', 2)]);

    await expect(consumeFefo(client(), 'wh-1', 'var-1', 5)).resolves.toEqual([
      { batchId: 'b1', quantity: 2 },
      { batchId: null, quantity: 3 },
    ]);
  });

  it('returns one untraceable take for a variant with no batches at all', async () => {
    await expect(consumeFefo(client(), 'wh-1', 'var-1', 5)).resolves.toEqual([
      { batchId: null, quantity: 5 },
    ]);

    expect(tx.inventoryBatch.update).not.toHaveBeenCalled();
  });

  it('always accounts for the full quantity asked for', async () => {
    tx.inventoryBatch.findMany.mockResolvedValue([batch('b1', 3), batch('b2', 2)]);

    const takes = await consumeFefo(client(), 'wh-1', 'var-1', 11);

    expect(takes.reduce((total, take) => total + take.quantity, 0)).toBe(11);
  });
});

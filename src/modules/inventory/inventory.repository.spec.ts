import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from '../admin/audit-log.repository';
import { InventoryRepository, ReceiptData } from './inventory.repository';

const warehouse = (overrides: Record<string, unknown> = {}) => ({
  id: 'wh-1',
  code: 'DHK',
  isActive: true,
  storageTypes: ['AMBIENT'],
  ...overrides,
});

const receipt: ReceiptData = {
  warehouseId: 'wh-1',
  variantId: 'var-1',
  quantity: 10,
  batchCode: null,
  expiresAt: null,
  unitCostPoysha: null,
  note: null,
  actorId: 'user-1',
};

/** The SQL text of a tagged-template `$executeRaw` call, placeholders joined as `?`. */
const sqlOf = (mock: jest.Mock, call = 0): { sql: string; values: unknown[] } => {
  const [strings, ...values] = mock.mock.calls[call] as [string[], ...unknown[]];
  return { sql: strings.join('?'), values };
};

/** `count` answers from a small table of other hubs, filtered by the real `where` it receives. */
type CountWhere = {
  isActive?: boolean;
  id?: { not: string };
  storageTypes?: { has: string };
};
const countFrom =
  (others: Array<{ id: string; isActive: boolean; storageTypes: string[] }>) =>
  ({ where }: { where: CountWhere }) =>
    Promise.resolve(
      others.filter(
        (hub) =>
          (where.isActive === undefined || hub.isActive === where.isActive) &&
          hub.id !== where.id?.not &&
          (where.storageTypes === undefined || hub.storageTypes.includes(where.storageTypes.has)),
      ).length,
    );

describe('InventoryRepository', () => {
  let tx: {
    $executeRaw: jest.Mock;
    warehouse: { findUniqueOrThrow: jest.Mock; count: jest.Mock; update: jest.Mock };
    inventory: { aggregate: jest.Mock; upsert: jest.Mock };
    inventoryBatch: { create: jest.Mock };
    stockMovement: { create: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };
  let auditLog: { appendWithin: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: InventoryRepository;
  const auditRow = { action: 'warehouse.deactivated' } as unknown as AuditLogWriteData;
  const audit = jest.fn(() => auditRow);

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      warehouse: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(warehouse()),
        count: jest.fn(),
        update: jest.fn(),
      },
      inventory: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantityOnHand: null } }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      inventoryBatch: { create: jest.fn().mockResolvedValue({ id: 'batch-1' }) },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
    auditLog = { appendWithin: jest.fn().mockResolvedValue(undefined) };
    logger = createMockLogger();
    audit.mockClear();
    repository = new InventoryRepository(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogRepository,
      logger,
    );
  });

  describe('deactivateWarehouse', () => {
    it('takes the hub lifecycle lock before reading anything', async () => {
      tx.warehouse.count.mockResolvedValue(1);
      tx.warehouse.update.mockResolvedValue(warehouse({ isActive: false }));

      await repository.deactivateWarehouse('wh-1', audit);

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const lock = tx.$executeRaw.mock.invocationCallOrder[0];
      expect(lock).toBeLessThan(tx.warehouse.count.mock.invocationCallOrder[0]);
      expect(lock).toBeLessThan(tx.warehouse.findUniqueOrThrow.mock.invocationCallOrder[0]);
    });

    it('locks with a bigint-cast advisory lock keyed by the literal lifecycle key', async () => {
      tx.warehouse.count.mockResolvedValue(1);
      tx.warehouse.update.mockResolvedValue(warehouse({ isActive: false }));

      await repository.deactivateWarehouse('wh-1', audit);

      const { sql, values } = sqlOf(tx.$executeRaw);
      expect(sql).toBe('SELECT pg_advisory_xact_lock(?::bigint)');
      expect(values).toEqual([7301001]);
    });

    it('refuses, writing nothing, when the hub is the last active one', async () => {
      tx.warehouse.count.mockResolvedValue(0);

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toEqual({ kind: 'last-active' });
      expect(tx.warehouse.update).not.toHaveBeenCalled();
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('deactivates and reports how many active hubs remain', async () => {
      const updated = warehouse({ isActive: false });
      tx.warehouse.count.mockResolvedValue(2);
      tx.warehouse.update.mockResolvedValue(updated);

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toEqual({ kind: 'deactivated', warehouse: updated, activeRemaining: 2 });
      expect(tx.warehouse.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { isActive: false },
      });
      expect(audit).toHaveBeenCalledWith(warehouse(), updated);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow);
    });

    it('treats an already-inactive hub as idempotent, not as the last one', async () => {
      const alreadyInactive = warehouse({ isActive: false });
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(alreadyInactive);
      tx.warehouse.count.mockResolvedValue(0);

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toEqual({
        kind: 'deactivated',
        warehouse: alreadyInactive,
        activeRemaining: 0,
      });
      expect(audit).not.toHaveBeenCalled();
      expect(tx.warehouse.update).not.toHaveBeenCalled();
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('reports null on a database fault and never a refusal', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection lost'));

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), warehouseId: 'wh-1' },
        'Exception occurred in InventoryRepository.deactivateWarehouse',
      );
    });

    it('counts only other active hubs', async () => {
      tx.warehouse.count.mockResolvedValue(1);
      tx.warehouse.update.mockResolvedValue(warehouse({ isActive: false }));

      await repository.deactivateWarehouse('wh-1', audit);

      expect(tx.warehouse.count).toHaveBeenCalledWith({
        where: { isActive: true, id: { not: 'wh-1' } },
      });
    });
    it('refuses a hub that still holds stock, decided inside the lock', async () => {
      tx.warehouse.count.mockResolvedValue(2);
      tx.inventory.aggregate.mockResolvedValue({ _sum: { quantityOnHand: 7 } });

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toEqual({ kind: 'holds-stock' });
      expect(tx.inventory.aggregate).toHaveBeenCalledWith({
        where: { warehouseId: 'wh-1' },
        _sum: { quantityOnHand: true },
      });
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.inventory.aggregate.mock.invocationCallOrder[0],
      );
      expect(tx.warehouse.update).not.toHaveBeenCalled();
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('reports held stock before the last-active rule', async () => {
      tx.warehouse.count.mockResolvedValue(0);
      tx.inventory.aggregate.mockResolvedValue({ _sum: { quantityOnHand: 3 } });

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toEqual({ kind: 'holds-stock' });
    });

    it('does not check stock on an already-inactive hub', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(warehouse({ isActive: false }));
      tx.warehouse.count.mockResolvedValue(1);
      tx.inventory.aggregate.mockResolvedValue({ _sum: { quantityOnHand: 3 } });

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toMatchObject({ kind: 'deactivated', activeRemaining: 1 });
      expect(tx.inventory.aggregate).not.toHaveBeenCalled();
    });

    it.each(['CHILLED', 'FROZEN'])(
      'refuses the last active %s-capable hub while an AMBIENT hub remains',
      async (storageType) => {
        tx.warehouse.findUniqueOrThrow.mockResolvedValue(
          warehouse({ storageTypes: ['AMBIENT', storageType] }),
        );
        tx.warehouse.count.mockImplementation(
          countFrom([{ id: 'wh-2', isActive: true, storageTypes: ['AMBIENT'] }]),
        );

        const result = await repository.deactivateWarehouse('wh-1', audit);

        expect(result).toEqual({ kind: 'last-cold-capable', storageType });
        expect(tx.warehouse.count).toHaveBeenCalledWith({
          where: { isActive: true, id: { not: 'wh-1' }, storageTypes: { has: storageType } },
        });
        expect(tx.warehouse.update).not.toHaveBeenCalled();
        expect(auditLog.appendWithin).not.toHaveBeenCalled();
      },
    );

    it('deactivates a cold hub when another active hub can hold the same condition', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(
        warehouse({ storageTypes: ['AMBIENT', 'CHILLED', 'FROZEN'] }),
      );
      tx.warehouse.count.mockImplementation(
        countFrom([
          { id: 'wh-2', isActive: true, storageTypes: ['CHILLED'] },
          { id: 'wh-3', isActive: true, storageTypes: ['FROZEN'] },
          { id: 'wh-4', isActive: false, storageTypes: ['CHILLED', 'FROZEN'] },
        ]),
      );
      tx.warehouse.update.mockResolvedValue(warehouse({ isActive: false }));

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toMatchObject({ kind: 'deactivated', activeRemaining: 2 });
    });

    it('ignores an inactive hub when counting cold-capable hubs', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(warehouse({ storageTypes: ['FROZEN'] }));
      tx.warehouse.count.mockImplementation(
        countFrom([
          { id: 'wh-2', isActive: true, storageTypes: ['AMBIENT'] },
          { id: 'wh-3', isActive: false, storageTypes: ['FROZEN'] },
        ]),
      );

      const result = await repository.deactivateWarehouse('wh-1', audit);

      expect(result).toEqual({ kind: 'last-cold-capable', storageType: 'FROZEN' });
    });

    it('builds the audit row from the hub read under the lock', async () => {
      const underLock = warehouse({ code: 'DHK-LOCKED' });
      const updated = warehouse({ code: 'DHK-LOCKED', isActive: false });
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(underLock);
      tx.warehouse.count.mockResolvedValue(1);
      tx.warehouse.update.mockResolvedValue(updated);

      await repository.deactivateWarehouse('wh-1', audit);

      expect(audit).toHaveBeenCalledWith(underLock, updated);
    });
  });

  describe('reactivateWarehouse', () => {
    it('takes the exclusive lifecycle lock first', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(warehouse({ isActive: false }));
      tx.warehouse.update.mockResolvedValue(warehouse());
      tx.warehouse.count.mockResolvedValue(2);

      await repository.reactivateWarehouse('wh-1', audit);

      const { sql, values } = sqlOf(tx.$executeRaw);
      expect(sql).toBe('SELECT pg_advisory_xact_lock(?::bigint)');
      expect(values).toEqual([7301001]);
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.warehouse.findUniqueOrThrow.mock.invocationCallOrder[0],
      );
    });

    it('reactivates, audits with the locked row, and counts active hubs after the change', async () => {
      const inactive = warehouse({ isActive: false });
      const reactivated = warehouse();
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(inactive);
      tx.warehouse.update.mockResolvedValue(reactivated);
      tx.warehouse.count.mockResolvedValue(3);

      const result = await repository.reactivateWarehouse('wh-1', audit);

      expect(result).toEqual({ kind: 'reactivated', warehouse: reactivated, activeRemaining: 3 });
      expect(tx.warehouse.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { isActive: true },
      });
      expect(audit).toHaveBeenCalledWith(inactive, reactivated);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow);
      expect(tx.warehouse.count).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(tx.warehouse.update.mock.invocationCallOrder[0]).toBeLessThan(
        tx.warehouse.count.mock.invocationCallOrder[0],
      );
    });

    it('treats an already-active hub as idempotent: no write, no audit', async () => {
      tx.warehouse.count.mockResolvedValue(1);

      const result = await repository.reactivateWarehouse('wh-1', audit);

      expect(result).toEqual({ kind: 'reactivated', warehouse: warehouse(), activeRemaining: 1 });
      expect(tx.warehouse.update).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
      expect(auditLog.appendWithin).not.toHaveBeenCalled();
    });

    it('reports null on a database fault', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection lost'));

      const result = await repository.reactivateWarehouse('wh-1', audit);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), warehouseId: 'wh-1' },
        'Exception occurred in InventoryRepository.reactivateWarehouse',
      );
    });
  });

  describe('updateWarehouseStorage', () => {
    const coldHub = (storageType: string, overrides: Record<string, unknown> = {}) =>
      warehouse({ storageTypes: ['AMBIENT', storageType], ...overrides });

    it('takes the exclusive lifecycle lock before reading the hub', async () => {
      tx.warehouse.update.mockResolvedValue(warehouse());

      await repository.updateWarehouseStorage('wh-1', {}, ['AMBIENT'], audit);

      const { sql, values } = sqlOf(tx.$executeRaw);
      expect(sql).toBe('SELECT pg_advisory_xact_lock(?::bigint)');
      expect(values).toEqual([7301001]);
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.warehouse.findUniqueOrThrow.mock.invocationCallOrder[0],
      );
    });

    it.each(['CHILLED', 'FROZEN'])(
      'refuses to drop %s from the only active hub that holds it',
      async (storageType) => {
        tx.warehouse.findUniqueOrThrow.mockResolvedValue(coldHub(storageType));
        tx.warehouse.count.mockImplementation(
          countFrom([{ id: 'wh-2', isActive: true, storageTypes: ['AMBIENT'] }]),
        );

        const result = await repository.updateWarehouseStorage(
          'wh-1',
          { storageTypes: ['AMBIENT'] },
          ['AMBIENT'],
          audit,
        );

        expect(result).toEqual({ kind: 'last-cold-capable', storageType });
        expect(tx.warehouse.update).not.toHaveBeenCalled();
        expect(auditLog.appendWithin).not.toHaveBeenCalled();
      },
    );

    it('allows dropping a cold condition another active hub still holds', async () => {
      const updated = warehouse();
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(coldHub('CHILLED'));
      tx.warehouse.count.mockImplementation(
        countFrom([{ id: 'wh-2', isActive: true, storageTypes: ['CHILLED'] }]),
      );
      tx.warehouse.update.mockResolvedValue(updated);

      const result = await repository.updateWarehouseStorage(
        'wh-1',
        { storageTypes: ['AMBIENT'] },
        ['AMBIENT'],
        audit,
      );

      expect(result).toEqual({ kind: 'updated', warehouse: updated });
      expect(audit).toHaveBeenCalledWith(coldHub('CHILLED'), updated);
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow);
    });

    it('does not guard an edit that keeps every cold condition', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(coldHub('FROZEN'));
      tx.warehouse.update.mockResolvedValue(coldHub('FROZEN'));

      const result = await repository.updateWarehouseStorage(
        'wh-1',
        { storageTypes: ['FROZEN', 'CHILLED'] },
        ['FROZEN', 'CHILLED'],
        audit,
      );

      expect(result).toMatchObject({ kind: 'updated' });
      expect(tx.warehouse.count).not.toHaveBeenCalled();
    });

    it('does not guard a hub that is already out of service', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue(coldHub('CHILLED', { isActive: false }));
      tx.warehouse.update.mockResolvedValue(warehouse({ isActive: false }));

      const result = await repository.updateWarehouseStorage('wh-1', {}, ['AMBIENT'], audit);

      expect(result).toMatchObject({ kind: 'updated' });
      expect(tx.warehouse.count).not.toHaveBeenCalled();
    });

    it('reports null on a database fault', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection lost'));

      const result = await repository.updateWarehouseStorage('wh-1', {}, ['AMBIENT'], audit);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), warehouseId: 'wh-1' },
        'Exception occurred in InventoryRepository.updateWarehouseStorage',
      );
    });
  });

  describe('receive', () => {
    it('takes the SHARED lifecycle lock before reading the hub', async () => {
      await repository.receive(receipt);

      const { sql, values } = sqlOf(tx.$executeRaw);
      expect(sql).toBe('SELECT pg_advisory_xact_lock_shared(?::bigint)');
      expect(values).toEqual([7301001]);
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.warehouse.findUniqueOrThrow.mock.invocationCallOrder[0],
      );
    });

    it('books the batch, the total and the ledger entry for an active hub', async () => {
      const result = await repository.receive(receipt);

      expect(result).toEqual({ kind: 'received', batch: { id: 'batch-1' } });
      expect(tx.warehouse.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        select: { isActive: true },
      });
      expect(tx.inventory.upsert).toHaveBeenCalledTimes(1);
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    });

    it('refuses, writing nothing, when the hub went out of service before the lock', async () => {
      tx.warehouse.findUniqueOrThrow.mockResolvedValue({ isActive: false });

      const result = await repository.receive(receipt);

      expect(result).toEqual({ kind: 'warehouse-inactive' });
      expect(tx.inventoryBatch.create).not.toHaveBeenCalled();
      expect(tx.inventory.upsert).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('reports null on a database fault', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection lost'));

      const result = await repository.receive(receipt);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), warehouseId: 'wh-1', variantId: 'var-1' },
        'Exception occurred in InventoryRepository.receive',
      );
    });
  });
});

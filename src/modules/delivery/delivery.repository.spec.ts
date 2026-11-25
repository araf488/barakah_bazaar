import { PinoLogger } from 'nestjs-pino';
import { UserRole } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { DeliveryRepository } from './delivery.repository';

const auditRow = () => ({
  actorId: 'user-1',
  actorEmail: null,
  actorRole: UserRole.OPS,
  action: 'delivery_zone.created',
  entityType: 'DeliveryZone',
  entityId: 'zone-1',
  before: undefined,
  after: undefined,
  requestId: null,
});

describe('DeliveryRepository', () => {
  let tx: {
    deliveryZone: { create: jest.Mock; update: jest.Mock };
    deliveryZoneRule: { deleteMany: jest.Mock };
    deliverySlot: { create: jest.Mock; update: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    deliveryZone: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    deliveryZoneRule: { findMany: jest.Mock };
    deliverySlot: { findMany: jest.Mock; findUnique: jest.Mock };
    order: { groupBy: jest.Mock };
  };
  let auditLog: { appendWithin: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: DeliveryRepository;

  beforeEach(() => {
    tx = {
      deliveryZone: {
        create: jest.fn().mockResolvedValue({ id: 'zone-1', rules: [] }),
        update: jest.fn().mockResolvedValue({ id: 'zone-1', rules: [] }),
      },
      deliveryZoneRule: { deleteMany: jest.fn() },
      deliverySlot: {
        create: jest.fn().mockResolvedValue({ id: 'slot-1' }),
        update: jest.fn().mockResolvedValue({ id: 'slot-1' }),
      },
    };
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
      deliveryZone: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      deliveryZoneRule: { findMany: jest.fn() },
      deliverySlot: { findMany: jest.fn(), findUnique: jest.fn() },
      order: { groupBy: jest.fn() },
    };
    auditLog = { appendWithin: jest.fn() };
    logger = createMockLogger();
    repository = new DeliveryRepository(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogRepository,
      logger,
    );
  });

  describe('findCandidates', () => {
    it('asks for every rule that could match, at all three levels', async () => {
      prisma.deliveryZoneRule.findMany.mockResolvedValue([]);
      prisma.deliveryZone.findFirst.mockResolvedValue(null);

      await repository.findCandidates('Dhaka', 'Dhaka', 'Gulshan');

      expect(prisma.deliveryZoneRule.findMany.mock.calls[0][0].where).toEqual({
        zone: { isActive: true },
        division: 'Dhaka',
        OR: [
          { district: null, unit: null },
          { district: 'Dhaka', unit: null },
          { district: 'Dhaka', unit: 'Gulshan' },
        ],
      });
    });

    it('ignores rules belonging to a deactivated zone', async () => {
      prisma.deliveryZoneRule.findMany.mockResolvedValue([]);
      prisma.deliveryZone.findFirst.mockResolvedValue(null);

      await repository.findCandidates('Dhaka', 'Dhaka', 'Gulshan');

      expect(prisma.deliveryZoneRule.findMany.mock.calls[0][0].where.zone).toEqual({
        isActive: true,
      });
    });

    it('only accepts an active zone as the fallback', async () => {
      prisma.deliveryZoneRule.findMany.mockResolvedValue([]);
      prisma.deliveryZone.findFirst.mockResolvedValue(null);

      await repository.findCandidates('Dhaka', 'Dhaka', 'Gulshan');

      expect(prisma.deliveryZone.findFirst.mock.calls[0][0].where).toEqual({
        isDefault: true,
        isActive: true,
      });
    });

    it('returns null rather than an empty match set when the read fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findCandidates('Dhaka', 'Dhaka', 'Gulshan')).resolves.toBeNull();
    });
  });

  describe('createAudited', () => {
    it('writes the zone, its rules and the audit row in one transaction', async () => {
      await repository.createAudited(
        {
          nameEn: 'Inside Dhaka',
          nameBn: null,
          feePoysha: 6000n,
          freeAbovePoysha: null,
          isDefault: false,
          isActive: true,
          sortOrder: 0,
        },
        [{ division: 'Dhaka', district: null, unit: null }],
        () => auditRow(),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.deliveryZone.create.mock.calls[0][0].data.rules).toEqual({
        create: [{ division: 'Dhaka', district: null, unit: null }],
      });
      expect(auditLog.appendWithin).toHaveBeenCalled();
    });

    it('returns null when the unique index rejects an already-claimed place', async () => {
      prisma.$transaction.mockRejectedValue(new Error('unique constraint'));

      await expect(
        repository.createAudited(
          {
            nameEn: 'X',
            nameBn: null,
            feePoysha: 0n,
            freeAbovePoysha: null,
            isDefault: false,
            isActive: true,
            sortOrder: 0,
          },
          [],
          () => auditRow(),
        ),
      ).resolves.toBeNull();
    });
  });

  describe('updateAudited', () => {
    it('clears the old rules before writing the new set', async () => {
      await repository.updateAudited(
        'zone-1',
        { feePoysha: 8000n },
        [{ division: 'Dhaka', district: null, unit: null }],
        () => auditRow(),
      );

      expect(tx.deliveryZoneRule.deleteMany).toHaveBeenCalledWith({ where: { zoneId: 'zone-1' } });
      expect(tx.deliveryZoneRule.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.deliveryZone.update.mock.invocationCallOrder[0],
      );
    });

    it('leaves the rules alone when none were supplied', async () => {
      await repository.updateAudited('zone-1', { feePoysha: 8000n }, null, () => auditRow());

      expect(tx.deliveryZoneRule.deleteMany).not.toHaveBeenCalled();
      expect(tx.deliveryZone.update.mock.calls[0][0].data).not.toHaveProperty('rules');
    });
  });

  describe('findConflictingRules', () => {
    it('does not query at all for an empty rule set', async () => {
      await expect(repository.findConflictingRules([])).resolves.toEqual([]);
      expect(prisma.deliveryZoneRule.findMany).not.toHaveBeenCalled();
    });

    it('asks for an exact match on every place named', async () => {
      prisma.deliveryZoneRule.findMany.mockResolvedValue([]);

      await repository.findConflictingRules([{ division: 'Dhaka', district: 'Dhaka', unit: null }]);

      expect(prisma.deliveryZoneRule.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ division: 'Dhaka', district: 'Dhaka', unit: null }],
      });
    });

    it('returns null when the check cannot run', async () => {
      prisma.deliveryZoneRule.findMany.mockRejectedValue(new Error('connection reset'));

      await expect(
        repository.findConflictingRules([{ division: 'Dhaka', district: null, unit: null }]),
      ).resolves.toBeNull();
    });
  });

  describe('slot writes', () => {
    const slotData = () => ({
      warehouseId: 'wh-1',
      labelEn: 'Morning 9-11',
      labelBn: null,
      startMinute: 540,
      endMinute: 660,
      daysOfWeek: [0, 1, 2],
      capacity: 20,
      cutoffMinutes: 120,
      supportsPerishable: true,
      isActive: true,
      sortOrder: 0,
    });

    it('writes the window and its audit row in one transaction', async () => {
      await repository.createSlotAudited(slotData(), () => auditRow());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.deliverySlot.create).toHaveBeenCalledWith({ data: slotData() });
      expect(auditLog.appendWithin).toHaveBeenCalled();
    });

    it('audits the window as it was actually saved, not as it was asked for', async () => {
      // The audit callback receives the created row, so a default the database filled in is
      // what gets recorded.
      tx.deliverySlot.create.mockResolvedValue({ id: 'slot-9', capacity: 20 });
      const audit = jest.fn().mockReturnValue(auditRow());

      await repository.createSlotAudited(slotData(), audit);

      expect(audit).toHaveBeenCalledWith({ id: 'slot-9', capacity: 20 });
    });

    it('returns null rather than a half-written window when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('boom'));

      await expect(repository.createSlotAudited(slotData(), () => auditRow())).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('updates the window by id, with its audit row', async () => {
      await repository.updateSlotAudited('slot-1', slotData(), () => auditRow());

      expect(tx.deliverySlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: slotData(),
      });
      expect(auditLog.appendWithin).toHaveBeenCalled();
    });

    it('returns null when the window to update is gone', async () => {
      prisma.$transaction.mockRejectedValue(new Error('record not found'));

      await expect(
        repository.updateSlotAudited('slot-1', slotData(), () => auditRow()),
      ).resolves.toBeNull();
    });
  });

  describe('findAllSlots', () => {
    it('groups the windows by hub, then by the order they should be shown in', async () => {
      prisma.deliverySlot.findMany.mockResolvedValue([]);

      await repository.findAllSlots();

      expect(prisma.deliverySlot.findMany).toHaveBeenCalledWith({
        orderBy: [{ warehouseId: 'asc' }, { sortOrder: 'asc' }, { startMinute: 'asc' }],
      });
    });

    it('returns null rather than an empty list when the read fails', async () => {
      // An empty list would read as "this shop has no delivery windows".
      prisma.deliverySlot.findMany.mockRejectedValue(new Error('boom'));

      await expect(repository.findAllSlots()).resolves.toBeNull();
    });
  });

  describe('countBookings', () => {
    it('does not query at all for a hub with no windows', async () => {
      await expect(repository.countBookings([], new Date(), new Date())).resolves.toEqual(
        new Map(),
      );
      expect(prisma.order.groupBy).not.toHaveBeenCalled();
    });

    it('leaves cancelled and refunded orders out of the count', async () => {
      // A van that is not delivering an order has room for another one.
      prisma.order.groupBy.mockResolvedValue([]);

      await repository.countBookings(['slot-1'], new Date(2026, 0, 1), new Date(2026, 0, 8));

      const where = prisma.order.groupBy.mock.calls[0][0].where as {
        status: { notIn: string[] };
      };

      expect(where.status.notIn).toEqual(['CANCELLED', 'REFUNDED']);
    });

    it('keys each count by window and delivery day', async () => {
      prisma.order.groupBy.mockResolvedValue([
        { deliverySlotId: 'slot-1', deliveryDate: new Date(2026, 0, 5), _count: { _all: 3 } },
      ]);

      const counts = await repository.countBookings(
        ['slot-1'],
        new Date(2026, 0, 1),
        new Date(2026, 0, 8),
      );

      expect(counts?.get('slot-1|2026-01-05')).toBe(3);
    });

    it('skips a row with no window or no date rather than keying it wrongly', async () => {
      prisma.order.groupBy.mockResolvedValue([
        { deliverySlotId: null, deliveryDate: new Date(2026, 0, 5), _count: { _all: 3 } },
        { deliverySlotId: 'slot-1', deliveryDate: null, _count: { _all: 2 } },
      ]);

      const counts = await repository.countBookings(
        ['slot-1'],
        new Date(2026, 0, 1),
        new Date(2026, 0, 8),
      );

      expect(counts?.size).toBe(0);
    });

    it('returns null when the count cannot run', async () => {
      prisma.order.groupBy.mockRejectedValue(new Error('boom'));

      await expect(
        repository.countBookings(['slot-1'], new Date(), new Date()),
      ).resolves.toBeNull();
    });
  });
});

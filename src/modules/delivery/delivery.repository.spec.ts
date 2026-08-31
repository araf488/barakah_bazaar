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
  };
  let prisma: {
    $transaction: jest.Mock;
    deliveryZone: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    deliveryZoneRule: { findMany: jest.Mock };
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
    };
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
      deliveryZone: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      deliveryZoneRule: { findMany: jest.fn() },
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
});

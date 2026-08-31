import { PinoLogger } from 'nestjs-pino';
import { PromotionType, UserRole } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { PromotionRepository } from './promotion.repository';

const auditRow = () => ({
  actorId: 'user-1',
  actorEmail: null,
  actorRole: UserRole.MARKETING,
  action: 'promotion.created',
  entityType: 'Promotion',
  entityId: 'promo-1',
  before: undefined,
  after: undefined,
  requestId: null,
});

const writeData = {
  code: 'EID25',
  nameEn: 'Eid 25%',
  nameBn: null,
  type: PromotionType.PERCENTAGE,
  value: 25n,
  minSubtotalPoysha: 0n,
  maxDiscountPoysha: null,
  startsAt: new Date('2026-09-01T00:00:00.000Z'),
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  isActive: true,
};

describe('PromotionRepository', () => {
  let tx: { promotion: { create: jest.Mock; update: jest.Mock } };
  let prisma: {
    $transaction: jest.Mock;
    promotion: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    promotionRedemption: { count: jest.Mock };
  };
  let auditLog: { appendWithin: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: PromotionRepository;

  beforeEach(() => {
    tx = {
      promotion: {
        create: jest.fn().mockResolvedValue({ id: 'promo-1' }),
        update: jest.fn().mockResolvedValue({ id: 'promo-1' }),
      },
    };
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
      promotion: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      promotionRedemption: { count: jest.fn() },
    };
    auditLog = { appendWithin: jest.fn() };
    logger = createMockLogger();
    repository = new PromotionRepository(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogRepository,
      logger,
    );
  });

  describe('countRedemptions', () => {
    it('counts the total and this customer separately, in one round trip', async () => {
      prisma.promotionRedemption.count.mockResolvedValueOnce(42).mockResolvedValueOnce(1);

      await expect(repository.countRedemptions('promo-1', 'user-1')).resolves.toEqual({
        total: 42,
        byCustomer: 1,
      });

      expect(prisma.promotionRedemption.count.mock.calls[0][0].where).toEqual({
        promotionId: 'promo-1',
      });
      expect(prisma.promotionRedemption.count.mock.calls[1][0].where).toEqual({
        promotionId: 'promo-1',
        userId: 'user-1',
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('returns null rather than zero when the count cannot be read', async () => {
      // Zero would read as "plenty of room left" and oversell the code.
      prisma.$transaction.mockRejectedValue(new Error('connection reset'));

      await expect(repository.countRedemptions('promo-1', 'user-1')).resolves.toBeNull();
    });
  });

  describe('findByCode', () => {
    it('returns undefined for a code that does not exist', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(repository.findByCode('NOPE')).resolves.toBeUndefined();
    });

    it('returns null when the lookup itself fails', async () => {
      prisma.promotion.findUnique.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findByCode('EID25')).resolves.toBeNull();
    });
  });

  describe('createAudited', () => {
    it('writes the promotion and its audit row in one transaction', async () => {
      await repository.createAudited(writeData, () => auditRow());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.promotion.create).toHaveBeenCalledWith({ data: writeData });
      expect(auditLog.appendWithin).toHaveBeenCalledWith(tx, auditRow());
    });

    it('returns null when the audit row fails, so the caller refuses', async () => {
      auditLog.appendWithin.mockRejectedValue(new Error('audit table gone'));

      await expect(repository.createAudited(writeData, () => auditRow())).resolves.toBeNull();
    });

    it('returns null when the unique code index rejects a duplicate', async () => {
      prisma.$transaction.mockRejectedValue(new Error('unique constraint'));

      await expect(repository.createAudited(writeData, () => auditRow())).resolves.toBeNull();
    });
  });

  describe('updateAudited', () => {
    it('writes the change and its audit row together', async () => {
      await repository.updateAudited('promo-1', { value: 30n }, () => auditRow());

      expect(tx.promotion.update).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: { value: 30n },
      });
      expect(auditLog.appendWithin).toHaveBeenCalled();
    });

    it('returns null when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('deadlock'));

      await expect(
        repository.updateAudited('promo-1', { value: 30n }, () => auditRow()),
      ).resolves.toBeNull();
    });
  });

  describe('findPage', () => {
    it('returns the page and its count', async () => {
      prisma.promotion.findMany.mockResolvedValue([{ id: 'promo-1' }]);
      prisma.promotion.count.mockResolvedValue(1);

      await expect(repository.findPage({}, 0, 50)).resolves.toEqual({
        items: [{ id: 'promo-1' }],
        total: 1,
      });
    });

    it('returns null when the page cannot be read', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection reset'));

      await expect(repository.findPage({}, 0, 50)).resolves.toBeNull();
    });
  });
});

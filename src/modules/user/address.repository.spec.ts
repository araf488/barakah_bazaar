import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { addressFixture } from '../../../test/support/user-fixtures';
import { AddressCreateData, AddressRepository } from './address.repository';

interface AddressDelegate {
  findMany: jest.Mock;
  findFirst: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
}

const createData: AddressCreateData = {
  label: 'Home',
  recipientName: 'Rahim Uddin',
  phone: '+8801712345678',
  division: 'Dhaka',
  district: 'Dhaka',
  upazila: 'Savar',
  area: 'Birulia',
  addressLine: 'House 12',
  postCode: null,
  latitude: null,
  longitude: null,
};

describe('AddressRepository', () => {
  let address: AddressDelegate;
  let prisma: { address: AddressDelegate; $transaction: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let repository: AddressRepository;

  beforeEach(() => {
    address = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    prisma = {
      address,
      // Runs the callback against the same mocked client, which is what lets the
      // multi-statement methods be asserted at all.
      $transaction: jest.fn((run: (client: { address: AddressDelegate }) => unknown) =>
        run({ address }),
      ),
    };
    logger = createMockLogger();
    repository = new AddressRepository(prisma as unknown as PrismaService, logger);
  });

  describe('findAllForUser', () => {
    it('filters by owner and excludes soft-deleted rows', async () => {
      address.findMany.mockResolvedValue([]);

      await repository.findAllForUser('user-1');

      expect(address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', deletedAt: null } }),
      );
    });

    it('orders the default first, then newest', async () => {
      address.findMany.mockResolvedValue([]);

      await repository.findAllForUser('user-1');

      expect(address.findMany.mock.calls[0][0].orderBy).toEqual([
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ]);
    });

    it('returns null instead of throwing when the database fails', async () => {
      address.findMany.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findAllForUser('user-1')).resolves.toBeNull();
    });
  });

  describe('findOneForUser', () => {
    it('scopes the lookup by owner and id together, never by id alone', async () => {
      address.findFirst.mockResolvedValue(addressFixture());

      await repository.findOneForUser('user-1', 'address-1');

      expect(address.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null, id: 'address-1' },
      });
    });

    it("returns undefined for another customer's address id", async () => {
      address.findFirst.mockResolvedValue(null);

      await expect(repository.findOneForUser('user-1', 'address-9')).resolves.toBeUndefined();
    });

    it('returns null — distinct from undefined — when the read failed', async () => {
      address.findFirst.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findOneForUser('user-1', 'address-1')).resolves.toBeNull();
    });
  });

  describe('countForUser', () => {
    it('counts only live addresses', async () => {
      address.count.mockResolvedValue(3);

      await expect(repository.countForUser('user-1')).resolves.toBe(3);
      expect(address.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
      });
    });

    it('returns null when the count failed', async () => {
      address.count.mockRejectedValue(new Error('connection refused'));

      await expect(repository.countForUser('user-1')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it("makes the customer's first address the default", async () => {
      address.count.mockResolvedValue(0);
      address.create.mockResolvedValue(addressFixture());

      await repository.create('user-1', createData);

      expect(address.create.mock.calls[0][0].data.isDefault).toBe(true);
    });

    it('does not make a later address the default', async () => {
      address.count.mockResolvedValue(2);
      address.create.mockResolvedValue(addressFixture({ isDefault: false }));

      await repository.create('user-1', createData);

      expect(address.create.mock.calls[0][0].data.isDefault).toBe(false);
    });

    it('stamps the owner from the argument, never from the payload', async () => {
      address.count.mockResolvedValue(0);
      address.create.mockResolvedValue(addressFixture());

      await repository.create('user-1', createData);

      expect(address.create.mock.calls[0][0].data.userId).toBe('user-1');
    });

    it('decides the default inside the same transaction as the insert', async () => {
      address.count.mockResolvedValue(0);
      address.create.mockResolvedValue(addressFixture());

      await repository.create('user-1', createData);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('retries as a non-default when a concurrent create won the default', async () => {
      // Two first addresses can both count zero; the loser must still get its address saved.
      address.count.mockResolvedValue(0);
      address.create
        .mockRejectedValueOnce(Object.assign(new Error('unique violation'), { code: 'P2002' }))
        .mockResolvedValueOnce(addressFixture({ isDefault: false }));

      const result = await repository.create('user-1', createData);

      expect(result).toEqual(addressFixture({ isDefault: false }));
      expect(address.create.mock.calls[1][0].data.isDefault).toBe(false);
    });

    it('does not retry a failure that is not a duplicate default', async () => {
      address.count.mockResolvedValue(0);
      address.create.mockRejectedValue(new Error('connection refused'));

      await expect(repository.create('user-1', createData)).resolves.toBeNull();
      expect(address.create).toHaveBeenCalledTimes(1);
    });

    it('returns null when the insert failed', async () => {
      address.count.mockResolvedValue(0);
      address.create.mockRejectedValue(new Error('connection refused'));

      await expect(repository.create('user-1', createData)).resolves.toBeNull();
    });
  });

  describe('updateForUser', () => {
    it('updates the row it first proved the caller owns', async () => {
      address.findFirst.mockResolvedValue(addressFixture());
      address.update.mockResolvedValue(addressFixture({ recipientName: 'Karim Mia' }));

      const result = await repository.updateForUser('user-1', 'address-1', {
        recipientName: 'Karim Mia',
      });

      expect(address.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null, id: 'address-1' },
      });
      expect(address.update).toHaveBeenCalledWith({
        where: { id: 'address-1' },
        data: { recipientName: 'Karim Mia' },
      });
      expect(result).toEqual(addressFixture({ recipientName: 'Karim Mia' }));
    });

    it('returns undefined without writing when the row is not the caller’s', async () => {
      address.findFirst.mockResolvedValue(null);

      await expect(
        repository.updateForUser('user-1', 'address-9', { recipientName: 'x' }),
      ).resolves.toBeUndefined();
      expect(address.update).not.toHaveBeenCalled();
    });

    it('returns null when the write failed', async () => {
      address.findFirst.mockResolvedValue(addressFixture());
      address.update.mockRejectedValue(new Error('connection refused'));

      await expect(
        repository.updateForUser('user-1', 'address-1', { recipientName: 'x' }),
      ).resolves.toBeNull();
    });
  });

  describe('softDeleteForUser', () => {
    it('stamps deletedAt rather than removing the row', async () => {
      address.findFirst.mockResolvedValueOnce(addressFixture({ isDefault: false }));
      address.update.mockResolvedValue(addressFixture({ isDefault: false }));

      await repository.softDeleteForUser('user-1', 'address-1');

      const args = address.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'address-1' });
      expect(args.data.deletedAt).toBeInstanceOf(Date);
      expect(args.data.isDefault).toBe(false);
    });

    it('promotes the newest surviving address when the default was deleted', async () => {
      address.findFirst
        .mockResolvedValueOnce(addressFixture({ id: 'address-1', isDefault: true }))
        .mockResolvedValueOnce(addressFixture({ id: 'address-2', isDefault: false }));
      address.update.mockResolvedValue(addressFixture({ id: 'address-1' }));

      await repository.softDeleteForUser('user-1', 'address-1');

      expect(address.findFirst.mock.calls[1][0]).toEqual({
        where: { userId: 'user-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(address.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'address-2' },
        data: { isDefault: true },
      });
    });

    it('leaves the customer with no default when nothing survives', async () => {
      address.findFirst
        .mockResolvedValueOnce(addressFixture({ isDefault: true }))
        .mockResolvedValueOnce(null);
      address.update.mockResolvedValue(addressFixture());

      await repository.softDeleteForUser('user-1', 'address-1');

      expect(address.update).toHaveBeenCalledTimes(1);
    });

    it('does not promote anything when a non-default address was deleted', async () => {
      address.findFirst.mockResolvedValueOnce(addressFixture({ isDefault: false }));
      address.update.mockResolvedValue(addressFixture({ isDefault: false }));

      await repository.softDeleteForUser('user-1', 'address-1');

      expect(address.findFirst).toHaveBeenCalledTimes(1);
      expect(address.update).toHaveBeenCalledTimes(1);
    });

    it('returns undefined for an address the caller does not own', async () => {
      address.findFirst.mockResolvedValue(null);

      await expect(repository.softDeleteForUser('user-1', 'address-9')).resolves.toBeUndefined();
      expect(address.update).not.toHaveBeenCalled();
    });
  });

  describe('promoteDefault', () => {
    it('clears the previous default before setting the new one', async () => {
      address.findFirst.mockResolvedValue(addressFixture({ id: 'address-2', isDefault: false }));
      address.updateMany.mockResolvedValue({ count: 1 });
      address.update.mockResolvedValue(addressFixture({ id: 'address-2', isDefault: true }));

      await repository.promoteDefault('user-1', 'address-2');

      expect(address.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
      expect(address.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        address.update.mock.invocationCallOrder[0],
      );
    });

    it('does both writes in one transaction, so no request can observe two defaults', async () => {
      address.findFirst.mockResolvedValue(addressFixture({ isDefault: false }));
      address.updateMany.mockResolvedValue({ count: 1 });
      address.update.mockResolvedValue(addressFixture({ isDefault: true }));

      await repository.promoteDefault('user-1', 'address-2');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('is a no-op that still succeeds when the address is already default', async () => {
      const already = addressFixture({ id: 'address-1', isDefault: true });
      address.findFirst.mockResolvedValue(already);

      await expect(repository.promoteDefault('user-1', 'address-1')).resolves.toEqual(already);
      expect(address.updateMany).not.toHaveBeenCalled();
      expect(address.update).not.toHaveBeenCalled();
    });

    it("returns undefined for another customer's address", async () => {
      address.findFirst.mockResolvedValue(null);

      await expect(repository.promoteDefault('user-1', 'address-9')).resolves.toBeUndefined();
    });

    it('returns null and logs when the transaction failed', async () => {
      const failure = new Error('deadlock detected');
      prisma.$transaction.mockRejectedValue(failure);

      await expect(repository.promoteDefault('user-1', 'address-2')).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure, userId: 'user-1', addressId: 'address-2' }),
        'Exception occurred in AddressRepository.promoteDefault',
      );
    });
  });
});

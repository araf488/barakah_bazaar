import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { userFixture } from '../../../test/support/user-fixtures';
import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  let prisma: { user: { update: jest.Mock } };
  let logger: jest.Mocked<PinoLogger>;
  let repository: UserRepository;

  beforeEach(() => {
    prisma = { user: { update: jest.fn() } };
    logger = createMockLogger();
    repository = new UserRepository(prisma as unknown as PrismaService, logger);
  });

  describe('updateFullName', () => {
    it('returns the updated row', async () => {
      const updated = userFixture({ fullName: 'Karim Mia' });
      prisma.user.update.mockResolvedValue(updated);

      await expect(repository.updateFullName('user-1', 'Karim Mia')).resolves.toEqual(updated);
    });

    it('keys the update on the local user id, never on anything from the request', async () => {
      prisma.user.update.mockResolvedValue(userFixture());

      await repository.updateFullName('user-1', 'Karim Mia');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { fullName: 'Karim Mia' },
      });
    });

    it('returns null instead of throwing when the database fails', async () => {
      prisma.user.update.mockRejectedValue(new Error('connection refused'));

      await expect(repository.updateFullName('user-1', 'Karim Mia')).resolves.toBeNull();
    });

    it('logs the failure with the exception object', async () => {
      const failure = new Error('connection refused');
      prisma.user.update.mockRejectedValue(failure);

      await repository.updateFullName('user-1', 'Karim Mia');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure, userId: 'user-1' }),
        'Exception occurred in UserRepository.updateFullName',
      );
    });
  });
});

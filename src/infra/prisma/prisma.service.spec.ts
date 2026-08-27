import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { PrismaService } from './prisma.service';

/**
 * Constructed with no DATABASE_URL, so the adapter points at the placeholder
 * and nothing here can reach a real database. The client's own methods are
 * stubbed on the instance; what is under test is the degradation logic, not
 * Prisma.
 */
const buildService = (): {
  service: PrismaService;
  logger: ReturnType<typeof createMockLogger>;
} => {
  const logger = createMockLogger();
  const service = new PrismaService(createMockConfig({}), logger);
  return { service, logger };
};

describe('PrismaService', () => {
  describe('onModuleInit', () => {
    it('reports connected only after a query round-trip succeeds', async () => {
      const { service, logger } = buildService();
      jest.spyOn(service, '$connect').mockResolvedValue(undefined);
      jest.spyOn(service, 'ping').mockResolvedValue(true);

      await service.onModuleInit();

      expect(service.isConnected).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Connected to Postgres');
    });

    it('does not claim a connection when the verifying query fails', async () => {
      const { service, logger } = buildService();
      jest.spyOn(service, '$connect').mockResolvedValue(undefined);
      jest.spyOn(service, 'ping').mockResolvedValue(false);

      await service.onModuleInit();

      expect(service.isConnected).toBe(false);
      expect(logger.info).not.toHaveBeenCalledWith('Connected to Postgres');
    });

    it('degrades instead of throwing when connecting rejects', async () => {
      const { service } = buildService();
      jest.spyOn(service, '$connect').mockRejectedValue(new Error('ENOTFOUND'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.isConnected).toBe(false);
    });

    it('logs the exception object when connecting rejects', async () => {
      const { service, logger } = buildService();
      const failure = new Error('ENOTFOUND');
      jest.spyOn(service, '$connect').mockRejectedValue(failure);

      await service.onModuleInit();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Could not connect to Postgres at boot; the API will run in degraded mode',
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects cleanly', async () => {
      const { service } = buildService();
      const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

      await service.onModuleDestroy();

      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('swallows and logs a disconnect failure rather than blocking shutdown', async () => {
      const { service, logger } = buildService();
      jest.spyOn(service, '$disconnect').mockRejectedValue(new Error('already closed'));

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('starts false, before any connection attempt', () => {
      expect(buildService().service.isConnected).toBe(false);
    });
  });
});

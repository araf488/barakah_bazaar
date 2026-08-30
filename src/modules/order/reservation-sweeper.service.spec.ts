import { PinoLogger } from 'nestjs-pino';
import { OrderStatus } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { OrderRepository } from './order.repository';
import { ReservationSweeper } from './reservation-sweeper.service';

const staleOrder = (id: string, status: OrderStatus = OrderStatus.PLACED) =>
  ({ id, status, orderNumber: `BB-20260830-${id}` }) as never;

describe('ReservationSweeper', () => {
  let repository: jest.Mocked<Pick<OrderRepository, 'findExpiredHolds' | 'transition'>>;
  let logger: jest.Mocked<PinoLogger>;
  let sweeper: ReservationSweeper;

  beforeEach(() => {
    repository = { findExpiredHolds: jest.fn(), transition: jest.fn() };
    logger = createMockLogger();
    sweeper = new ReservationSweeper(repository as unknown as OrderRepository, logger);
  });

  it('cancels every abandoned order so its stock goes back on sale', async () => {
    repository.findExpiredHolds.mockResolvedValue([staleOrder('ord-1'), staleOrder('ord-2')]);
    repository.transition.mockResolvedValue({} as never);

    await sweeper.sweep();

    expect(repository.transition).toHaveBeenCalledTimes(2);
    expect(repository.transition).toHaveBeenCalledWith(
      'ord-1',
      OrderStatus.PLACED,
      OrderStatus.CANCELLED,
      null,
      'Cancelled automatically: the order was not confirmed in time and the stock was returned.',
    );
  });

  it('cancels from the status the order is actually in, not an assumed one', async () => {
    repository.findExpiredHolds.mockResolvedValue([staleOrder('ord-3', OrderStatus.CONFIRMED)]);
    repository.transition.mockResolvedValue({} as never);

    await sweeper.sweep();

    expect(repository.transition).toHaveBeenCalledWith(
      'ord-3',
      OrderStatus.CONFIRMED,
      OrderStatus.CANCELLED,
      null,
      expect.any(String),
    );
  });

  it('does nothing when no hold has expired', async () => {
    repository.findExpiredHolds.mockResolvedValue([]);

    await sweeper.sweep();

    expect(repository.transition).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('leaves stock held when the holds cannot be read, rather than guessing', async () => {
    repository.findExpiredHolds.mockResolvedValue(null);

    await sweeper.sweep();

    expect(repository.transition).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('keeps sweeping after one order loses a race to a concurrent transition', async () => {
    repository.findExpiredHolds.mockResolvedValue([staleOrder('ord-1'), staleOrder('ord-2')]);
    repository.transition.mockResolvedValueOnce(null).mockResolvedValueOnce({} as never);

    await sweeper.sweep();

    expect(repository.transition).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      { examined: 2, cancelled: 1 },
      'Released stock held by abandoned orders',
    );
  });

  it('swallows a thrown error so a failed tick cannot take the process down', async () => {
    repository.findExpiredHolds.mockRejectedValue(new Error('connection reset'));

    await expect(sweeper.sweep()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  describe('lifecycle', () => {
    afterEach(() => {
      sweeper.onModuleDestroy();
      jest.useRealTimers();
    });

    it('sweeps on a timer once started', async () => {
      jest.useFakeTimers();
      repository.findExpiredHolds.mockResolvedValue([]);

      sweeper.onModuleInit();
      jest.advanceTimersByTime(5 * 60_000);
      await Promise.resolve();

      expect(repository.findExpiredHolds).toHaveBeenCalledTimes(1);
    });

    it('stops sweeping once shut down, so a torn-down app cannot touch the database', async () => {
      jest.useFakeTimers();
      repository.findExpiredHolds.mockResolvedValue([]);

      sweeper.onModuleInit();
      sweeper.onModuleDestroy();
      jest.advanceTimersByTime(60 * 60_000);
      await Promise.resolve();

      expect(repository.findExpiredHolds).not.toHaveBeenCalled();
    });

    it('shuts down cleanly when it was never started', () => {
      expect(() => sweeper.onModuleDestroy()).not.toThrow();
    });
  });
});

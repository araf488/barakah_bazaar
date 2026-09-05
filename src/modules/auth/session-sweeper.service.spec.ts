import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthConstants } from './auth.constants';
import { SessionRepository } from './sessions/session.repository';
import { SessionSweeper } from './session-sweeper.service';

describe('SessionSweeper', () => {
  let repository: {
    deleteExpired: jest.Mock;
    deleteRecoveryCodesForDisabledUsers: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let sweeper: SessionSweeper;

  beforeEach(() => {
    repository = {
      deleteExpired: jest.fn().mockResolvedValue(0),
      deleteRecoveryCodesForDisabledUsers: jest.fn().mockResolvedValue(0),
    };
    logger = createMockLogger();
    sweeper = new SessionSweeper(repository as unknown as SessionRepository, logger);
  });

  afterEach(() => {
    sweeper.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('what it deletes', () => {
    it('deletes sessions whose hard ceiling has passed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-04T10:00:00.000Z'));
      repository.deleteExpired.mockResolvedValue(4);

      await sweeper.sweep();

      expect(repository.deleteExpired).toHaveBeenCalledWith(new Date('2026-09-04T10:00:00.000Z'));
    });

    it('keeps a revoked session that has not yet reached its absolute expiry', async () => {
      // The deletion is keyed on absoluteExpiresAt alone, never on revokedAt: "when did this
      // session end, and who ended it" is what an incident review needs, and the row is
      // already refused by the guard, so keeping it costs nothing.
      await sweeper.sweep();

      const [before] = repository.deleteExpired.mock.calls[0] as [Date];

      expect(repository.deleteExpired).toHaveBeenCalledTimes(1);
      expect(before).toBeInstanceOf(Date);
      expect(repository.deleteExpired.mock.calls[0]).toHaveLength(1);
    });

    it('deletes recovery codes belonging to accounts that are no longer enabled', async () => {
      repository.deleteRecoveryCodesForDisabledUsers.mockResolvedValue(6);

      await sweeper.sweep();

      expect(repository.deleteRecoveryCodesForDisabledUsers).toHaveBeenCalledTimes(1);
    });

    it('reports what it removed when it removed anything', async () => {
      repository.deleteExpired.mockResolvedValue(4);
      repository.deleteRecoveryCodesForDisabledUsers.mockResolvedValue(6);

      await sweeper.sweep();

      expect(logger.info).toHaveBeenCalledWith(
        { sessions: 4, recoveryCodes: 6 },
        'Swept expired sessions and dead recovery codes',
      );
    });

    it('says nothing on a pass that found nothing, so a quiet log stays readable', async () => {
      await sweeper.sweep();

      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('failure', () => {
    it('warns rather than throwing when a delete fails, and still tries the other', async () => {
      repository.deleteExpired.mockResolvedValue(null);

      await expect(sweeper.sweep()).resolves.toBeUndefined();

      expect(repository.deleteRecoveryCodesForDisabledUsers).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('never rethrows, because an unhandled rejection in a timer takes the process down', async () => {
      repository.deleteExpired.mockRejectedValue(new Error('connection reset'));

      await expect(sweeper.sweep()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('the timer', () => {
    it('sweeps on the configured interval', () => {
      jest.useFakeTimers();

      sweeper.onModuleInit();
      jest.advanceTimersByTime(AuthConstants.SweepIntervalMinutes * 60_000);

      expect(repository.deleteExpired).toHaveBeenCalledTimes(1);
    });

    it('does not hold the process open waiting for the next tick', () => {
      jest.useFakeTimers();
      const unref = jest.spyOn(global, 'setInterval');

      sweeper.onModuleInit();

      const timer = unref.mock.results[0].value as NodeJS.Timeout;

      expect(timer.hasRef()).toBe(false);
    });

    it('stops on shutdown', () => {
      jest.useFakeTimers();

      sweeper.onModuleInit();
      sweeper.onModuleDestroy();
      jest.advanceTimersByTime(AuthConstants.SweepIntervalMinutes * 60_000 * 3);

      expect(repository.deleteExpired).not.toHaveBeenCalled();
    });
  });
});

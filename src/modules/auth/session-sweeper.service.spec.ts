import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthConstants } from './auth.constants';
import { PasswordResetRepository } from './password-reset/password-reset.repository';
import { SessionRepository } from './sessions/session.repository';
import { SessionSweeper } from './session-sweeper.service';
import { EmailVerificationRepository } from './verification/email-verification.repository';

describe('SessionSweeper', () => {
  let repository: {
    deleteExpired: jest.Mock;
    deleteRecoveryCodesForDisabledUsers: jest.Mock;
  };
  let verifications: {
    deleteStale: jest.Mock;
  };
  let passwordResets: { deleteStale: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let sweeper: SessionSweeper;

  beforeEach(() => {
    repository = {
      deleteExpired: jest.fn().mockResolvedValue(0),
      deleteRecoveryCodesForDisabledUsers: jest.fn().mockResolvedValue(0),
    };
    verifications = {
      deleteStale: jest.fn().mockResolvedValue(0),
    };
    passwordResets = { deleteStale: jest.fn().mockResolvedValue(0) };
    logger = createMockLogger();
    sweeper = new SessionSweeper(
      repository as unknown as SessionRepository,
      verifications as unknown as EmailVerificationRepository,
      passwordResets as unknown as PasswordResetRepository,
      logger,
    );
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
      verifications.deleteStale.mockResolvedValue(3);

      await sweeper.sweep();

      expect(logger.info).toHaveBeenCalledWith(
        { sessions: 4, recoveryCodes: 6, verifications: 3, passwordResets: 0 },
        'Swept expired sessions, dead recovery codes, finished verifications and resets',
      );
    });

    it('says nothing on a pass that found nothing, so a quiet log stays readable', async () => {
      await sweeper.sweep();

      expect(logger.info).not.toHaveBeenCalled();
    });

    it('deletes verifications that are finished and older than the retention window', async () => {
      verifications.deleteStale.mockResolvedValue(3);

      await sweeper.sweep();

      const cutoff = verifications.deleteStale.mock.calls[0][0] as Date;
      // 30 days, asserted as the literal rather than the constant.
      expect(Date.now() - cutoff.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -4);
    });

    it('deletes resets that are finished and older than the retention window', async () => {
      passwordResets.deleteStale.mockResolvedValue(2);

      await sweeper.sweep();

      const cutoff = passwordResets.deleteStale.mock.calls[0][0] as Date;
      // 30 days, asserted as the literal rather than the constant.
      expect(Date.now() - cutoff.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -4);
    });

    it('reports the resets it removed', async () => {
      passwordResets.deleteStale.mockResolvedValue(2);

      await sweeper.sweep();

      expect(logger.info.mock.calls[0][0]).toMatchObject({ passwordResets: 2 });
    });
  });

  describe('failure', () => {
    // Weak by itself: the verification delete runs LAST in sweep(), so "sessions still ran"
    // is true no matter what happens after the session delete — it cannot catch a regression
    // where something added after the session delete (an early return, a rethrow) stops the
    // pass early. Kept for its own value (it does show the verification failure is warned on
    // and does not block the sweep from completing), but see the tests below for the direction
    // that can actually break: something failing EARLY in the pass must not stop what runs
    // LATER in the pass.
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

    it('still sweeps sessions when the verification delete fails', async () => {
      verifications.deleteStale.mockResolvedValue(null);

      await sweeper.sweep();

      expect(repository.deleteExpired).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    // The direction the weak test above cannot cover: the verification delete runs LAST, so
    // only a test that fails an EARLIER delete and then checks the LATER one still ran can
    // catch a regression like an early return or a rethrow inserted right after the session
    // delete.
    it('still sweeps verifications when the session delete fails', async () => {
      repository.deleteExpired.mockResolvedValue(null);

      await sweeper.sweep();

      expect(verifications.deleteStale).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('still sweeps verifications when the recovery-code delete fails', async () => {
      repository.deleteRecoveryCodesForDisabledUsers.mockResolvedValue(null);

      await sweeper.sweep();

      expect(verifications.deleteStale).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('still sweeps everything else when the reset delete fails, and warns', async () => {
      passwordResets.deleteStale.mockResolvedValue(null);
      repository.deleteExpired.mockResolvedValue(1);

      await sweeper.sweep();

      expect(repository.deleteExpired).toHaveBeenCalled();
      expect(verifications.deleteStale).toHaveBeenCalled();
      expect(logger.warn.mock.calls[0][0]).toMatchObject({ passwordResets: null });
    });

    it('still sweeps resets when the verification delete fails', async () => {
      verifications.deleteStale.mockResolvedValue(null);

      await sweeper.sweep();

      expect(passwordResets.deleteStale).toHaveBeenCalled();
    });

    it('never rethrows when the verification delete rejects', async () => {
      verifications.deleteStale.mockRejectedValue(new Error('connection reset'));

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

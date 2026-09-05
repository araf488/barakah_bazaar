import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthConstants } from './auth.constants';
import { SessionRepository } from './sessions/session.repository';

/**
 * Removes session rows and recovery codes that have stopped meaning anything.
 *
 * Neither deletion changes what any request is allowed to do — the guard already refuses an
 * expired session, and a disabled account cannot sign in at all. What they change is how much
 * live credential material sits in the database waiting to be in a leaked dump, and how big a
 * table has to get before anyone notices nothing was ever cleaning it.
 *
 * **A revoked session that has not reached its absolute expiry is deliberately kept.** "When
 * did this session end, and who ended it" is exactly the question an incident review asks, and
 * deleting the row throws that away for no benefit: a revoked session is already refused, so
 * keeping it costs a row and buys the answer. The deletion is keyed on `absoluteExpiresAt`
 * alone for that reason — see `SessionRepository.deleteExpired`.
 *
 * Runs on a plain interval rather than through BullMQ or a scheduler package, copying
 * `ReservationSweeper`: the queue is optional and off by default, and this has to work on a
 * bare deployment with no Redis. Two instances sweeping at once is harmless — both issue the
 * same idempotent `deleteMany`, and the loser simply deletes nothing.
 */
@Injectable()
export class SessionSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly repository: SessionRepository,
    @InjectPinoLogger(SessionSweeper.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.sweep(),
      AuthConstants.SweepIntervalMinutes * AuthConstants.MillisecondsPerMinute,
    );

    // Never hold the process open for the next tick; shutdown should not wait on a timer.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** One pass. Public so the suite and any future queue worker can drive it directly. */
  async sweep(): Promise<void> {
    try {
      const sessions = await this.repository.deleteExpired(new Date());
      const recoveryCodes = await this.repository.deleteRecoveryCodesForDisabledUsers();

      if (sessions === null || recoveryCodes === null) {
        // A failed delete is not a problem the caller can act on and not one that grows:
        // the next tick tries again against the same rows.
        this.logger.warn(
          { sessions, recoveryCodes },
          'Session sweep could not complete; will retry',
        );
      }

      if (sessions || recoveryCodes) {
        this.logger.info(
          { sessions: sessions ?? 0, recoveryCodes: recoveryCodes ?? 0 },
          'Swept expired sessions and dead recovery codes',
        );
      }
    } catch (error) {
      // Never rethrow. An unhandled rejection from a timer callback takes the process down,
      // and a failed sweep costs nothing the next tick cannot recover.
      this.logger.error({ err: error }, 'Exception occurred in SessionSweeper.sweep');
    }
  }
}

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { OrderStatus } from '../../infra/prisma/prisma-client';
import { OrderConstants, OrderMessages } from './order.constants';
import { OrderRepository } from './order.repository';

/**
 * Returns stock held by orders nobody completed.
 *
 * Without this, an abandoned checkout holds its units for good: a hold is only released on
 * cancel or dispatch, so an order that reaches neither silently removes stock from sale. The
 * `(released_at, expires_at)` index exists to make finding them cheap.
 *
 * It cancels the order rather than releasing the hold directly, deliberately. Cancellation
 * already gives the stock back, writes the movement and records the event; a second path that
 * touched inventory would be a second place for stock and orders to drift apart.
 *
 * Runs on a plain interval rather than through BullMQ or a scheduler package: the queue is
 * optional and disabled by default, and returning abandoned stock has to work on a bare
 * deployment with no Redis. Two instances sweeping at once is harmless — the transition
 * refuses an order that has already moved, so the loser simply finds nothing to do.
 */
@Injectable()
export class ReservationSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly repository: OrderRepository,
    @InjectPinoLogger(ReservationSweeper.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), OrderConstants.SweepIntervalMinutes * 60_000);

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
      const stale = await this.repository.findExpiredHolds();

      if (stale === null) {
        // A read failure is not evidence the holds are dead. Leave the stock held.
        this.logger.warn('Reservation sweep could not read expired holds; will retry');
        return;
      }

      if (stale.length === 0) {
        return;
      }

      let cancelled = 0;

      for (const order of stale) {
        const result = await this.repository.transition(
          order.id,
          order.status,
          OrderStatus.CANCELLED,
          null,
          OrderMessages.AbandonedBySweep,
        );

        if (result) {
          cancelled += 1;
        }
      }

      // Worth info level: a sudden rise here means customers are abandoning checkout, which
      // is a product problem rather than a technical one.
      this.logger.info(
        { examined: stale.length, cancelled },
        'Released stock held by abandoned orders',
      );
    } catch (error) {
      // Never rethrow. An unhandled rejection from a timer callback takes the process down,
      // and a failed sweep costs nothing that the next tick cannot recover.
      this.logger.error({ err: error }, 'Exception occurred in ReservationSweeper.sweep');
    }
  }
}

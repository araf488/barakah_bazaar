import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Money } from '../../common/money/money';
import { Notification } from '../../infra/prisma/prisma-client';
import { OrderRepository } from '../order/order.repository';
import { NotificationConstants, TemplateVariables } from './notification.constants';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

/**
 * Second delivery attempt for messages the inline send did not get out.
 *
 * The recorded row *is* the queue. BullMQ is optional and off by default, so a bare
 * deployment with no Redis still has to retry a transient gateway failure — this is what
 * makes "a failed SMS must never fail a checkout" safe to rely on rather than a way to lose
 * messages quietly.
 *
 * Same interval shape as ReservationSweeper, for the same reason: no scheduler dependency,
 * unref'd so shutdown never waits on it, and safe to run on two instances at once because a
 * duplicate attempt costs one SMS rather than corrupting anything.
 */
@Injectable()
export class NotificationRetryService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly repository: NotificationRepository,
    private readonly notifications: NotificationService,
    private readonly orders: OrderRepository,
    @InjectPinoLogger(NotificationRetryService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.sweep(),
      NotificationConstants.RetryIntervalMinutes * 60_000,
    );

    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** One pass over everything still owed an attempt. */
  async sweep(): Promise<void> {
    try {
      const pending = await this.repository.findRetryable();

      if (pending === null) {
        this.logger.warn('Notification retry could not read pending messages; will retry');
        return;
      }

      if (pending.length === 0) {
        return;
      }

      let sent = 0;

      for (const notification of pending) {
        if (await this.retryOne(notification)) {
          sent += 1;
        }
      }

      this.logger.info({ examined: pending.length, sent }, 'Retried pending notifications');
    } catch (error) {
      // A timer callback that rejects takes the process down. Nothing here is worth that.
      this.logger.error({ err: error }, 'Exception occurred in NotificationRetryService.sweep');
    }
  }

  /** Rebuilds the template variables from the order, then hands off to the service. */
  private async retryOne(notification: Notification): Promise<boolean> {
    const variables = await this.resolveVariables(notification);

    if (variables === null) {
      // The order is gone or unreadable. Do not abandon the row on a read failure — the next
      // sweep may find it — but there is nothing to send this tick.
      return false;
    }

    return await this.notifications.retry(notification, variables);
  }

  /**
   * Variables are rebuilt from the order rather than stored on the notification, so a message
   * retried an hour later quotes the order as it is now instead of a stale copy.
   */
  private async resolveVariables(notification: Notification): Promise<TemplateVariables | null> {
    if (
      notification.referenceType !== NotificationConstants.OrderReference ||
      !notification.referenceId
    ) {
      return null;
    }

    const order = await this.orders.findById(notification.referenceId);

    if (!order) {
      return null;
    }

    return {
      orderNumber: order.orderNumber,
      recipientName: order.recipientName,
      total: Money.format(order.totalPoysha),
    };
  }
}

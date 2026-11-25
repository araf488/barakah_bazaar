import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Money } from '../../common/money/money';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import {
  Language,
  Notification,
  NotificationChannel,
  OrderStatus,
} from '../../infra/prisma/prisma-client';
import { SmsGateway } from '../auth/ports/sms-gateway.port';
import { AuthService } from '../auth/auth.service';
import {
  NOTIFICATION_TEMPLATES,
  NotificationConstants,
  NotificationMessages,
  NotificationTemplateId,
  NotificationTokens,
  ORDER_STATUS_TEMPLATES,
  TemplateVariables,
} from './notification.constants';
import { NotificationRepository } from './notification.repository';
import { NotificationDto, NotificationListDto, NotificationQueryDto } from './dto/notification.dto';
import { NotificationMapper } from './notification.mapper';

/** Everything needed to tell one customer about one order. */
export interface OrderNotificationContext {
  readonly userId: string;
  readonly phone: string | null;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly totalPoysha: bigint;
}

/**
 * Transactional messages.
 *
 * The load-bearing rule: **a notification never fails the thing that triggered it.** Every
 * path here returns rather than throws, and the order module calls it outside its
 * transaction. A customer whose SMS did not send still has an order.
 *
 * Sending is attempted inline rather than queued. BullMQ is optional and off by default, so
 * an inline attempt plus the retry sweep is what actually works on a bare deployment; the
 * recorded row is the queue.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly authService: AuthService,
    @Inject(NotificationTokens.SmsGateway) private readonly sms: SmsGateway,
    @InjectPinoLogger(NotificationService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Announces an order status to its customer.
   *
   * Returns nothing: there is no caller decision to make. A failure is recorded on the row
   * and retried by the sweep, and the caller must not branch on it.
   */
  async notifyOrderStatus(status: OrderStatus, context: OrderNotificationContext): Promise<void> {
    try {
      await this.dispatch(ORDER_STATUS_TEMPLATES[status], context);
    } catch (error) {
      // Belt and braces. dispatch() already swallows, but this method is called from inside
      // a checkout and must not be able to throw under any circumstance.
      this.logger.error(
        { err: error, orderId: context.orderId, status },
        'Exception occurred in NotificationService.notifyOrderStatus',
      );
    }
  }

  /** Retries one recorded message. Used by the sweep, which owns the retry policy. */
  async retry(notification: Notification, variables: TemplateVariables): Promise<boolean> {
    try {
      const body = NotificationService.render(
        notification.templateId as NotificationTemplateId,
        notification.language,
        variables,
      );

      if (body === null) {
        // The template was removed or renamed after the row was written. Retrying forever
        // cannot help, so burn the attempts rather than sweeping it every five minutes.
        await this.repository.markFailed(
          notification.id,
          NotificationConstants.MaxAttempts,
          `Unknown template ${notification.templateId}`,
        );
        return false;
      }

      return await this.deliver(notification, body);
    } catch (error) {
      this.logger.error(
        { err: error, notificationId: notification.id },
        'Exception occurred in NotificationService.retry',
      );
      return false;
    }
  }

  /** The signed-in customer's own message history. */
  async listMine(
    user: AuthenticatedUser,
    query: NotificationQueryDto,
  ): Promise<ServiceResponse<NotificationListDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const take = query.pageSize ?? NotificationConstants.DefaultPageSize;
      const page = query.page ?? 1;

      const result = await this.repository.findPageForUser(owner.data, (page - 1) * take, take);

      if (result === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, NotificationMessages.ListFailed);
      }

      return serviceOk({
        items: result.items.map((item): NotificationDto => NotificationMapper.toDto(item)),
        total: result.total,
        page,
        pageSize: take,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.userId },
        'Exception occurred in NotificationService.listMine',
      );
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, NotificationMessages.ListFailed);
    }
  }

  /** Records the intent, then attempts it once. */
  private async dispatch(
    templateId: NotificationTemplateId,
    context: OrderNotificationContext,
  ): Promise<void> {
    if (!context.phone) {
      // Nothing to record: a message with no recipient was never owed, so a row here would
      // make the retry sweep chase an address that does not exist.
      this.logger.info(
        { orderId: context.orderId, templateId },
        'Notification skipped: customer has no phone number',
      );
      return;
    }

    const template = NOTIFICATION_TEMPLATES[templateId];

    // Resolved here rather than passed in: which language a customer is written to in is this
    // module's business, and asking every caller to look it up would spread that decision
    // across the codebase. A read failure falls back to the column default rather than
    // dropping the message.
    const language = (await this.repository.findLanguage(context.userId)) ?? Language.BN;

    const notification = await this.repository.record({
      userId: context.userId,
      channel: template.channel,
      templateId,
      language,
      recipient: context.phone,
      referenceType: NotificationConstants.OrderReference,
      referenceId: context.orderId,
    });

    if (!notification) {
      // Recording failed, so there is no row for the sweep to retry. Do not send blind: an
      // unrecorded send is one nobody can audit or de-duplicate.
      return;
    }

    await this.deliver(notification, template.body[language](toVariables(context)));
  }

  /** One gateway attempt, with the outcome written back to the row. */
  private async deliver(notification: Notification, body: string): Promise<boolean> {
    if (notification.channel !== NotificationChannel.SMS) {
      // EMAIL and PUSH exist in the enum as seams; no adapter is wired yet.
      await this.repository.markFailed(
        notification.id,
        NotificationConstants.MaxAttempts,
        `No adapter for channel ${notification.channel}`,
      );
      return false;
    }

    const accepted = await this.sms
      .send({ to: notification.recipient, body })
      .catch((error: unknown) => {
        this.logger.warn(
          { err: error, notificationId: notification.id },
          'SMS gateway threw; treating as a failed attempt',
        );
        return false;
      });

    if (accepted) {
      return await this.repository.markSent(notification.id);
    }

    await this.repository.markFailed(
      notification.id,
      notification.attempts,
      'Gateway did not accept the message',
    );

    return false;
  }

  /** Renders a body, or null when the template id is not one this build knows. */
  private static render(
    templateId: NotificationTemplateId,
    language: Language,
    variables: TemplateVariables,
  ): string | null {
    const template = NOTIFICATION_TEMPLATES[templateId];

    return template ? template.body[language](variables) : null;
  }
}

/** Order context in the shape a template can substitute. */
const toVariables = (context: OrderNotificationContext): TemplateVariables => ({
  orderNumber: context.orderNumber,
  recipientName: context.recipientName,
  // Default locale for both languages: Money.format already carries the ৳ symbol, and
  // Latin digits render identically on every handset, whereas Bengali numerals depend on
  // the phone's font. The message text is what changes by language, not the number.
  total: Money.format(context.totalPoysha),
});

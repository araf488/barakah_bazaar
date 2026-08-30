import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  Language,
  Notification,
  NotificationChannel,
  NotificationStatus,
  Prisma,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationConstants } from './notification.constants';

/** `undefined` means no such row; `null` means the query itself failed. */
export type NotificationResult = Notification | null | undefined;

export interface RecordNotificationData {
  userId: string | null;
  channel: NotificationChannel;
  templateId: string;
  language: Language;
  recipient: string;
  referenceType: string | null;
  referenceId: string | null;
}

export interface NotificationPage {
  items: Notification[];
  total: number;
}

@Injectable()
export class NotificationRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(NotificationRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Writes the intent to send, before anything is attempted.
   *
   * Returning null here means the caller could not even record the message. That is worth a
   * log line but never worth failing the order that triggered it.
   */
  async record(data: RecordNotificationData): Promise<Notification | null> {
    try {
      return await this.prisma.notification.create({ data });
    } catch (error) {
      this.logger.error(
        { err: error, templateId: data.templateId },
        'Exception occurred in NotificationRepository.record',
      );
      return null;
    }
  }

  /**
   * Which language to write to this customer in.
   *
   * Returns null when the row cannot be read, so the caller falls back to the column default
   * rather than treating a database blip as a language preference.
   */
  async findLanguage(userId: string): Promise<Language | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { preferredLanguage: true },
      });

      return user?.preferredLanguage ?? null;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in NotificationRepository.findLanguage',
      );
      return null;
    }
  }

  /** Marks a delivered message. `attempts` counts the successful try too. */
  async markSent(id: string): Promise<boolean> {
    return this.settle(id, {
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      lastError: null,
      attempts: { increment: 1 },
    });
  }

  /**
   * Records a failed attempt, and abandons the message once it has burned its allowance.
   *
   * The decision is made from `attempts` as it will be *after* this increment, so the caller
   * does not have to know the retry policy.
   */
  async markFailed(id: string, attemptsSoFar: number, error: string): Promise<boolean> {
    const exhausted = attemptsSoFar + 1 >= NotificationConstants.MaxAttempts;

    return this.settle(id, {
      status: exhausted ? NotificationStatus.ABANDONED : NotificationStatus.FAILED,
      lastError: error.slice(0, NotificationConstants.MaxErrorLength),
      attempts: { increment: 1 },
    });
  }

  /**
   * Messages still owed an attempt: never sent, and not yet abandoned.
   *
   * Oldest first, so a backlog drains in the order customers were promised something rather
   * than newest-wins.
   */
  async findRetryable(): Promise<Notification[] | null> {
    try {
      return await this.prisma.notification.findMany({
        where: {
          status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] },
          attempts: { lt: NotificationConstants.MaxAttempts },
        },
        orderBy: { createdAt: 'asc' },
        take: NotificationConstants.RetryBatchSize,
      });
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in NotificationRepository.findRetryable',
      );
      return null;
    }
  }

  /** One customer's own message history, newest first. */
  async findPageForUser(
    userId: string,
    skip: number,
    take: number,
  ): Promise<NotificationPage | null> {
    try {
      const where: Prisma.NotificationWhereInput = { userId };

      const [items, total] = await this.prisma.$transaction([
        this.prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.notification.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in NotificationRepository.findPageForUser',
      );
      return null;
    }
  }

  /** Shared tail of markSent/markFailed: one update, failures swallowed into false. */
  private async settle(id: string, data: Prisma.NotificationUpdateInput): Promise<boolean> {
    try {
      await this.prisma.notification.update({ where: { id }, data });
      return true;
    } catch (error) {
      this.logger.error(
        { err: error, notificationId: id },
        'Exception occurred in NotificationRepository.settle',
      );
      return false;
    }
  }
}

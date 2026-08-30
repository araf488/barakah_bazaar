import { Notification } from '../../infra/prisma/prisma-client';
import { NotificationDto } from './dto/notification.dto';

/**
 * Wire format for a recorded message.
 *
 * `recipient`, `attempts` and `lastError` are deliberately withheld: the customer already
 * knows their own number, and attempt counts and gateway errors are operational detail that
 * would only invite support questions.
 */
export const NotificationMapper = {
  toDto(row: Notification): NotificationDto {
    return {
      id: row.id,
      channel: row.channel,
      templateId: row.templateId,
      language: row.language,
      status: row.status,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  },
} as const;

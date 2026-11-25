import { Language, NotificationChannel, OrderStatus } from '../../infra/prisma/prisma-client';

/** DI tokens for the ports this module resolves at runtime. */
export const NotificationTokens = {
  /** Reuses the Auth module's SMS port so there is one gateway seam, not two. */
  SmsGateway: 'NOTIFICATION_SMS_GATEWAY',
} as const;

export const NotificationConstants = {
  /**
   * How many times a message is attempted before it is abandoned.
   *
   * Low on purpose. A gateway hiccup clears in one retry; anything still failing after three
   * is almost always a dead number, and retrying that forever costs money on a real gateway.
   */
  MaxAttempts: 3,
  /** How often the retry sweep looks for messages still owed an attempt. */
  RetryIntervalMinutes: 5,
  /** Ceiling on one sweep, so a backlog is drained steadily rather than in one long lock. */
  RetryBatchSize: 50,
  /** Longest gateway error text kept. Enough to diagnose, short of storing a response body. */
  MaxErrorLength: 500,
  /** Default page size for the notification history endpoint. */
  DefaultPageSize: 20,
  MaxPageSize: 100,
  /** Base path for the customer-facing history endpoint. */
  RouteBase: 'notifications',
  /** What `referenceType` holds for an order-driven message. */
  OrderReference: 'Order',
} as const;

export const NotificationMessages = {
  /** The history endpoint could not read from the database. */
  ListFailed: 'Could not load notifications. Please try again.',
} as const;

/**
 * Template ids. A notification row stores this key rather than the rendered text, so the
 * wording can be corrected later without rewriting history, and no delivery address or OTP
 * ends up in the database.
 */
export const NotificationTemplates = {
  OrderPlaced: 'order.placed',
  OrderConfirmed: 'order.confirmed',
  OrderPicking: 'order.picking',
  OrderDispatched: 'order.dispatched',
  OrderDelivered: 'order.delivered',
  OrderCancelled: 'order.cancelled',
  OrderRefunded: 'order.refunded',
} as const;

export type NotificationTemplateId =
  (typeof NotificationTemplates)[keyof typeof NotificationTemplates];

/** The values a template may substitute. Anything not listed here cannot reach a message. */
export interface TemplateVariables {
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly total: string;
}

export interface NotificationTemplate {
  readonly channel: NotificationChannel;
  readonly body: Readonly<Record<Language, (vars: TemplateVariables) => string>>;
}

/**
 * Bodies in both languages, chosen by the customer's `preferredLanguage`.
 *
 * Kept short deliberately: a Bengali SMS is Unicode, which is 70 characters per segment
 * against 160 for Latin, so a chatty Bengali message silently costs three times an English
 * one. Every body here fits one segment.
 */
export const NOTIFICATION_TEMPLATES: Readonly<
  Record<NotificationTemplateId, NotificationTemplate>
> = {
  [NotificationTemplates.OrderPlaced]: {
    channel: NotificationChannel.SMS,
    body: {
      [Language.BN]: (v) => `আপনার অর্ডার ${v.orderNumber} পেয়েছি। মোট ${v.total}।`,
      [Language.EN]: (v) => `Order ${v.orderNumber} received. Total ${v.total}.`,
    },
  },
  [NotificationTemplates.OrderConfirmed]: {
    channel: NotificationChannel.SMS,
    body: {
      [Language.BN]: (v) => `অর্ডার ${v.orderNumber} নিশ্চিত হয়েছে।`,
      [Language.EN]: (v) => `Order ${v.orderNumber} is confirmed.`,
    },
  },
  [NotificationTemplates.OrderPicking]: {
    channel: NotificationChannel.SMS,
    body: {
      [Language.BN]: (v) => `অর্ডার ${v.orderNumber} প্যাক করা হচ্ছে।`,
      [Language.EN]: (v) => `Order ${v.orderNumber} is being packed.`,
    },
  },
  [NotificationTemplates.OrderDispatched]: {
    channel: NotificationChannel.SMS,
    body: {
      [Language.BN]: (v) => `অর্ডার ${v.orderNumber} পাঠানো হয়েছে।`,
      [Language.EN]: (v) => `Order ${v.orderNumber} is on the way.`,
    },
  },
  [NotificationTemplates.OrderDelivered]: {
    channel: NotificationChannel.SMS,
    body: {
      [Language.BN]: (v) => `অর্ডার ${v.orderNumber} পৌঁছে দেওয়া হয়েছে। ধন্যবাদ।`,
      [Language.EN]: (v) => `Order ${v.orderNumber} delivered. Thank you.`,
    },
  },
  [NotificationTemplates.OrderCancelled]: {
    channel: NotificationChannel.SMS,
    body: {
      [Language.BN]: (v) => `অর্ডার ${v.orderNumber} বাতিল হয়েছে।`,
      [Language.EN]: (v) => `Order ${v.orderNumber} has been cancelled.`,
    },
  },
  [NotificationTemplates.OrderRefunded]: {
    channel: NotificationChannel.SMS,
    body: {
      [Language.BN]: (v) => `অর্ডার ${v.orderNumber} ফেরত দেওয়া হয়েছে।`,
      [Language.EN]: (v) => `Order ${v.orderNumber} has been refunded.`,
    },
  },
};

/**
 * Which template announces each order status.
 *
 * A full map rather than a lookup with a fallback: adding an OrderStatus should be a compile
 * error here, not a status that silently notifies nobody.
 */
export const ORDER_STATUS_TEMPLATES: Readonly<Record<OrderStatus, NotificationTemplateId>> = {
  [OrderStatus.PLACED]: NotificationTemplates.OrderPlaced,
  [OrderStatus.CONFIRMED]: NotificationTemplates.OrderConfirmed,
  [OrderStatus.PICKING]: NotificationTemplates.OrderPicking,
  [OrderStatus.DISPATCHED]: NotificationTemplates.OrderDispatched,
  [OrderStatus.DELIVERED]: NotificationTemplates.OrderDelivered,
  [OrderStatus.CANCELLED]: NotificationTemplates.OrderCancelled,
  [OrderStatus.REFUNDED]: NotificationTemplates.OrderRefunded,
};

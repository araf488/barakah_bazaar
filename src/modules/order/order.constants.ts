import { OrderStatus } from '../../infra/prisma/prisma-client';

/** Order-module constants. Cross-cutting values live in app.constants.ts. */
export const OrderConstants = {
  RouteBase: 'orders',
  AdminRouteBase: 'admin/orders',
  OrderResourceName: 'Order',
  OrderNumberPrefix: 'BB',
  MaxCustomerNoteLength: 500,
  MaxStaffNoteLength: 500,
  /** How long a checkout hold survives before the sweep releases it. */
  ReservationMinutes: 30,
} as const;

/**
 * Which statuses may follow which.
 *
 * The whole point of modelling this: an order that jumps from PLACED to DELIVERED skipped
 * the dispatch that would have decremented stock, and nothing downstream would notice.
 * A status with no successors is terminal.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PLACED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PICKING, OrderStatus.CANCELLED],
  [OrderStatus.PICKING]: [OrderStatus.DISPATCHED, OrderStatus.CANCELLED],
  // Once it is with a rider it can only complete or come back as a refund; cancelling would
  // leave stock already off the shelf unaccounted for.
  [OrderStatus.DISPATCHED]: [OrderStatus.DELIVERED, OrderStatus.REFUNDED],
  [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

/** Statuses in which a customer may still cancel their own order themselves. */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
];

export const OrderMessages = {
  /** The basket had nothing in it. */
  CartEmpty: 'Your basket is empty.',
  /** The address does not belong to the caller, or was deleted. */
  AddressUnavailable: 'That delivery address is no longer available.',
  /** Prices moved since the items were added and the customer has not confirmed. */
  PricesChanged:
    'Some prices have changed since you added these items. Review your basket and try again.',
  /** {0} = item name, {1} = units available. */
  InsufficientStockTemplate: 'Only {0} of "{1}" left in stock. Adjust your basket and try again.',
  /** Nowhere to fulfil the order from. */
  NoWarehouse: 'We cannot deliver to that address right now.',
  /** {0} = from, {1} = to. */
  IllegalTransitionTemplate: 'An order cannot go from {0} to {1}.',
  /** A customer tried to cancel an order that has already left. */
  TooLateToCancel:
    'This order has already been dispatched and can no longer be cancelled. Contact support.',
} as const;

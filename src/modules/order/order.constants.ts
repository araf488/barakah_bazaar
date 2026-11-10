import { OrderStatus } from '../../infra/prisma/prisma-client';

/** Order-module constants. Cross-cutting values live in app.constants.ts. */
export const OrderConstants = {
  RouteBase: 'orders',
  AdminRouteBase: 'admin/orders',
  OrderResourceName: 'Order',
  /** `reference_type` on an order's stock reservations, movements and holds. */
  HoldReferenceType: 'Order',
  OrderNumberPrefix: 'BB',
  MaxCustomerNoteLength: 500,
  MaxStaffNoteLength: 500,
  /**
   * How long stock is held for an order awaiting PREPAYMENT before the sweep gives it back.
   * Short, because the customer is sitting at a payment screen.
   */
  PrepaymentHoldMinutes: 30,
  /**
   * How long stock is held for a CASH ON DELIVERY order.
   *
   * Deliberately long. A COD order has no payment step — it is placed and then waits for
   * staff to confirm it, which can easily take a day. Applying the prepayment window here
   * would release stock for perfectly good orders after half an hour and then oversell it.
   * This is a backstop against an order nobody ever actions, not a payment timeout.
   */
  CodHoldHours: 168,
  /**
   * Order event note when the customer moves an order from bKash to cash on delivery. Owned
   * here, not by the payment module: the switch is an order write, and the payment module
   * already imports from this one, so importing back would make the two modules cyclic.
   */
  SwitchedToCodNote: 'Customer switched to cash on delivery.',
  /** How often the sweep looks for holds that have outlived their order. */
  SweepIntervalMinutes: 5,
  /** How many abandoned orders one sweep pass picks up, oldest hold first. */
  ExpiredHoldBatchSize: 100,
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
  /** A slot id without its date, or a date without a slot. */
  SlotNeedsDate: 'Choose both a delivery slot and the date it falls on.',
  /**
   * A perishable in the basket cannot be delivered this far. Names the item, because the
   * customer's only useful action is to remove it — a generic refusal leaves them retrying
   * the same basket.
   */
  PerishableOutOfRangeTemplate:
    'We cannot deliver {0} to that address — it needs to stay cold over a shorter distance. Remove it to continue.',
  /** {0} = from, {1} = to. */
  IllegalTransitionTemplate: 'An order cannot go from {0} to {1}.',
  /**
   * Returned (409) when the order moved between the read and the swap, so the move the caller
   * asked for was never applied. Not the same as an illegal move: the move may be perfectly
   * legal from the order's new status.
   */
  OrderChangedConcurrently:
    'This order changed while you were working on it. Reload it and try again.',
  /** The sweep cancelled an order nobody acted on. */
  AbandonedBySweep:
    'Cancelled automatically: the order was not confirmed in time and the stock was returned.',
  /**
   * Returned (409) by `PATCH /orders/:id/payment-method` when the order cannot move to cash
   * on delivery: not a bKash order, no longer PLACED, already paid, past its hold, or holding
   * a captured bKash charge.
   */
  CannotSwitchToCod: 'This order can no longer switch to cash on delivery.',
  /** A customer tried to cancel an order that has already left. */
  TooLateToCancel:
    'This order has already been dispatched and can no longer be cancelled. Contact support.',
} as const;

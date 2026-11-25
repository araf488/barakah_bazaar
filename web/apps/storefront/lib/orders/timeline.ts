import type { Order, OrderEvent, OrderStatus } from '../checkout/api';

/** The road every order travels when nothing goes wrong (ORDER_TRANSITIONS in the API). */
export const ORDER_PROGRESS: readonly OrderStatus[] = [
  'PLACED',
  'CONFIRMED',
  'PICKING',
  'DISPATCHED',
  'DELIVERED',
];

/** Statuses that end the road early: the order was called off or its money went back. */
const STOPPING: readonly OrderStatus[] = ['CANCELLED', 'REFUNDED'];

/**
 * - `done`: the order has been through this step.
 * - `current`: where it is now.
 * - `upcoming`: still ahead.
 * - `stopped`: the order was cancelled or refunded here.
 */
export type StepState = 'done' | 'current' | 'upcoming' | 'stopped';

export interface TimelineStep {
  status: OrderStatus;
  state: StepState;
  /** When the order reached this step (ISO), or `null` when it has not or it is not recorded. */
  at: string | null;
  /** The reason given with a cancellation or refund; other steps carry none. */
  note: string | null;
}

/** The latest event that moved the order into `status`. */
const lastEventInto = (events: readonly OrderEvent[], status: OrderStatus): OrderEvent | null =>
  [...events].reverse().find((event) => event.toStatus === status) ?? null;

const reachedAt = (order: Order, events: readonly OrderEvent[], status: OrderStatus) =>
  lastEventInto(events, status)?.createdAt ?? (status === 'PLACED' ? order.placedAt : null);

/** A live order: the steps behind it are done, its own is current (done once delivered). */
const progressSteps = (order: Order, events: readonly OrderEvent[]): TimelineStep[] => {
  const position = ORDER_PROGRESS.indexOf(order.status);
  return ORDER_PROGRESS.map((status, index) => {
    let state: StepState = 'upcoming';
    if (index < position || (index === position && status === 'DELIVERED')) {
      state = 'done';
    } else if (index === position) {
      state = 'current';
    }
    return {
      status,
      state,
      at: state === 'upcoming' ? null : reachedAt(order, events, status),
      note: null,
    };
  });
};

/** A stopped order: the steps it actually passed, then where it stopped and why. */
const stoppedSteps = (order: Order, events: readonly OrderEvent[]): TimelineStep[] => {
  const passed = ORDER_PROGRESS.filter(
    (status) => status === 'PLACED' || lastEventInto(events, status) !== null,
  ).map<TimelineStep>((status) => ({
    status,
    state: 'done',
    at: reachedAt(order, events, status),
    note: null,
  }));
  const stop = lastEventInto(events, order.status);
  return [
    ...passed,
    {
      status: order.status,
      state: 'stopped',
      at: stop?.createdAt ?? null,
      note: stop?.note ?? null,
    },
  ];
};

/**
 * The order's journey as steps to draw. Event notes are shown only for a cancellation or refund:
 * those carry the reason the shopper needs, while other notes are written for staff.
 */
export const buildTimeline = (order: Order): TimelineStep[] => {
  const events = order.events ?? [];
  return STOPPING.includes(order.status)
    ? stoppedSteps(order, events)
    : progressSteps(order, events);
};

import { describe, expect, it } from 'vitest';

import { order, orderEvent } from '../../../test/checkout';
import { buildTimeline } from '../timeline';

const PLACED_AT = '2026-11-19T10:00:00Z';
const CONFIRMED_AT = '2026-11-19T10:20:00Z';
const PICKING_AT = '2026-11-19T11:00:00Z';
const DISPATCHED_AT = '2026-11-19T12:00:00Z';
const DELIVERED_AT = '2026-11-19T13:00:00Z';

const statesOf = (steps: ReturnType<typeof buildTimeline>) =>
  steps.map((step) => `${step.status}:${step.state}`);

describe('buildTimeline', () => {
  it('shows a new order at its first step with the rest still to come', () => {
    const steps = buildTimeline(order({ status: 'PLACED', events: [] }));
    expect(statesOf(steps)).toEqual([
      'PLACED:current',
      'CONFIRMED:upcoming',
      'PICKING:upcoming',
      'DISPATCHED:upcoming',
      'DELIVERED:upcoming',
    ]);
    // No PLACED event recorded: the order's own placement time stands in.
    expect(steps[0]?.at).toBe(PLACED_AT);
    expect(steps.slice(1).every((step) => step.at === null)).toBe(true);
  });

  it('marks the steps behind an order on the road as done, with their times', () => {
    const steps = buildTimeline(
      order({
        status: 'DISPATCHED',
        events: [
          orderEvent('PLACED', PLACED_AT),
          orderEvent('CONFIRMED', CONFIRMED_AT, { fromStatus: 'PLACED' }),
          orderEvent('PICKING', PICKING_AT, { fromStatus: 'CONFIRMED' }),
          orderEvent('DISPATCHED', DISPATCHED_AT, { fromStatus: 'PICKING', note: 'Staff only' }),
        ],
      }),
    );
    expect(statesOf(steps)).toEqual([
      'PLACED:done',
      'CONFIRMED:done',
      'PICKING:done',
      'DISPATCHED:current',
      'DELIVERED:upcoming',
    ]);
    expect(steps.map((step) => step.at)).toEqual([
      PLACED_AT,
      CONFIRMED_AT,
      PICKING_AT,
      DISPATCHED_AT,
      null,
    ]);
    // Notes on the way are written for staff and never shown.
    expect(steps.every((step) => step.note === null)).toBe(true);
  });

  it('shows a delivered order as complete', () => {
    const steps = buildTimeline(
      order({ status: 'DELIVERED', events: [orderEvent('DELIVERED', DELIVERED_AT)] }),
    );
    expect(steps.every((step) => step.state === 'done')).toBe(true);
    expect(steps.at(-1)?.at).toBe(DELIVERED_AT);
  });

  it('stops a cancelled order where it was, with the reason given', () => {
    const steps = buildTimeline(
      order({
        status: 'CANCELLED',
        events: [
          orderEvent('PLACED', PLACED_AT),
          orderEvent('CONFIRMED', CONFIRMED_AT),
          orderEvent('CANCELLED', PICKING_AT, { note: 'Ordered twice' }),
        ],
      }),
    );
    expect(statesOf(steps)).toEqual(['PLACED:done', 'CONFIRMED:done', 'CANCELLED:stopped']);
    expect(steps.at(-1)).toEqual({
      status: 'CANCELLED',
      state: 'stopped',
      at: PICKING_AT,
      note: 'Ordered twice',
    });
  });

  it('shows a refund after the steps the order really went through', () => {
    const steps = buildTimeline(
      order({
        status: 'REFUNDED',
        events: [
          orderEvent('CONFIRMED', CONFIRMED_AT),
          orderEvent('PICKING', PICKING_AT),
          orderEvent('DISPATCHED', DISPATCHED_AT),
          orderEvent('DELIVERED', DELIVERED_AT),
          orderEvent('REFUNDED', '2026-11-20T09:00:00Z'),
        ],
      }),
    );
    expect(statesOf(steps)).toEqual([
      'PLACED:done',
      'CONFIRMED:done',
      'PICKING:done',
      'DISPATCHED:done',
      'DELIVERED:done',
      'REFUNDED:stopped',
    ]);
    expect(steps.at(-1)?.note).toBeNull();
  });

  it('copes with a cancelled order that has no history at all', () => {
    expect(statesOf(buildTimeline(order({ status: 'CANCELLED' })))).toEqual([
      'PLACED:done',
      'CANCELLED:stopped',
    ]);
  });

  it('uses the latest time when a step was reached more than once', () => {
    const steps = buildTimeline(
      order({
        status: 'CONFIRMED',
        events: [orderEvent('CONFIRMED', CONFIRMED_AT), orderEvent('CONFIRMED', PICKING_AT)],
      }),
    );
    expect(steps[1]?.at).toBe(PICKING_AT);
  });
});

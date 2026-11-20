import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { order, orderEvent } from '../../../test/checkout';
import { renderWithIntl } from '../../../test/intl';
import { OrderTimeline } from '../OrderTimeline';

const stepTexts = () => screen.getAllByRole('listitem').map((step) => step.textContent);

describe('OrderTimeline', () => {
  it('marks where the order is now, with what has happened and what is still to come', () => {
    renderWithIntl(
      <OrderTimeline
        order={order({
          status: 'CONFIRMED',
          events: [
            orderEvent('PLACED', '2026-11-19T10:00:00Z'),
            orderEvent('CONFIRMED', '2026-11-19T10:20:00Z'),
          ],
        })}
      />,
    );
    const current = screen
      .getAllByRole('listitem')
      .find((step) => step.getAttribute('aria-current'));
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(within(current!).getByText(/Confirmed/)).toBeInTheDocument();
    expect(current).toHaveTextContent('19 Nov, 4:20 pm');
    expect(current).toHaveTextContent('We checked your order and are getting it ready.');

    const [placed, , picking] = stepTexts();
    expect(placed).toContain('Placed (done)');
    expect(picking).toContain('Being packed (still to come)');
    // A step not reached yet has no time and no description.
    expect(picking).not.toContain('picked and packed');
  });

  it('ends a cancelled order where it stopped, with the reason given', () => {
    renderWithIntl(
      <OrderTimeline
        order={order({
          status: 'CANCELLED',
          events: [orderEvent('CANCELLED', '2026-11-19T11:00:00Z', { note: 'Ordered twice' })],
        })}
      />,
    );
    const steps = stepTexts();
    expect(steps).toHaveLength(2);
    expect(steps[1]).toContain('Cancelled (stopped here)');
    expect(steps[1]).toContain('Reason: Ordered twice');
  });

  it('writes the steps and times in Bangla on a Bangla page', () => {
    renderWithIntl(<OrderTimeline order={order({ status: 'PLACED' })} />, 'bn');
    expect(stepTexts()[0]).toContain('অর্ডার হয়েছে');
    expect(stepTexts()[0]).toContain('১৯');
  });
});

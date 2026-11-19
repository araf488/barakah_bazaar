import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { DeliveryFacts } from '../DeliveryFacts';

describe('DeliveryFacts', () => {
  it('states the three delivery and payment facts the API enforces', () => {
    renderWithIntl(<DeliveryFacts />);

    expect(screen.getByRole('heading', { name: 'How your order reaches you' })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('listitem')
        .map((li) => li.firstElementChild?.nextSibling?.firstChild?.textContent),
    ).toEqual([
      'Cold chain for perishables',
      'Pick your delivery slot',
      'Cash on delivery or bKash',
    ]);
  });

  it('makes no certification, same-day or returns promise', () => {
    renderWithIntl(<DeliveryFacts />);
    expect(screen.queryByText(/certified|same-day|10 AM|refund|return/i)).not.toBeInTheDocument();
  });
});

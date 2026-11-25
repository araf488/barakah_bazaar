import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { PaymentChooser } from '../PaymentChooser';

describe('PaymentChooser', () => {
  it('states cash on delivery when it is the only method, with nothing to choose', () => {
    renderWithIntl(<PaymentChooser methods={['CASH_ON_DELIVERY']} />);
    expect(screen.getByText('Cash on delivery')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('offers each method as a radio joined to the place-order form, cash first', () => {
    renderWithIntl(<PaymentChooser methods={['CASH_ON_DELIVERY', 'BKASH']} />);
    const cash = screen.getByRole('radio', { name: /Cash on delivery/ });
    const bkash = screen.getByRole('radio', { name: /bKash/ });

    expect(cash).toBeChecked();
    expect(bkash).not.toBeChecked();
    for (const radio of [cash, bkash]) {
      expect(radio).toHaveAttribute('form', 'place-order');
      expect(radio).toHaveAttribute('name', 'paymentMethod');
    }
    expect(bkash).toHaveAttribute('value', 'BKASH');
    expect(screen.getByRole('group', { name: 'How would you like to pay?' })).toBeInTheDocument();
  });

  it('keeps the bKash name as written on a Bangla page', () => {
    renderWithIntl(<PaymentChooser methods={['CASH_ON_DELIVERY', 'BKASH']} />, 'bn');
    expect(screen.getByRole('radio', { name: /^bKash/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /ক্যাশ অন ডেলিভারি/ })).toBeChecked();
  });
});

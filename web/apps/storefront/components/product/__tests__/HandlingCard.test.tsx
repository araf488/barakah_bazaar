import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { HandlingCard } from '../HandlingCard';

describe('HandlingCard', () => {
  it('explains the cold chain for a chilled product, with its shelf life and range', () => {
    renderWithIntl(
      <HandlingCard
        handling={{
          isPerishable: true,
          storageType: 'CHILLED',
          shelfLifeHours: 36,
          maxDeliveryDistanceKm: 12,
        }}
      />,
    );

    expect(screen.getByText('Cold-chain delivery')).toBeInTheDocument();
    expect(
      screen.getByText('Kept chilled, so it only goes out in delivery slots with a cold van.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Keeps for 36 hours')).toBeInTheDocument();
    expect(screen.getByText('Delivered within 12 km of our hub')).toBeInTheDocument();
  });

  it('counts a long shelf life in days', () => {
    renderWithIntl(
      <HandlingCard
        handling={{ isPerishable: true, storageType: 'FROZEN', shelfLifeHours: 720 }}
      />,
    );

    expect(
      screen.getByText('Kept frozen, so it only goes out in delivery slots with a cold van.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Keeps for 30 days')).toBeInTheDocument();
  });

  it('describes a shelf-stable product as regular delivery, with no extra facts', () => {
    renderWithIntl(<HandlingCard handling={{ isPerishable: false, storageType: 'AMBIENT' }} />);

    expect(screen.getByText('Regular delivery')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('makes no same-day or cut-off promise', () => {
    renderWithIntl(<HandlingCard handling={{ isPerishable: true, storageType: 'CHILLED' }} />);
    expect(screen.queryByText(/same-day|10 AM|before/i)).not.toBeInTheDocument();
  });
});

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { RatingSummary } from '../RatingSummary';

describe('RatingSummary', () => {
  it('says it is not rated yet, rather than showing zero stars', () => {
    renderWithIntl(<RatingSummary rating={{ average: null, count: 0 }} />);
    expect(screen.getByText('Not rated yet')).toBeInTheDocument();
  });

  it('shows the average and count, read out in full', () => {
    renderWithIntl(<RatingSummary rating={{ average: 4.25, count: 3 }} />);

    expect(screen.getByText('4.3')).toBeInTheDocument();
    expect(screen.getByText('Rated 4.3 out of 5 from 3 reviews')).toBeInTheDocument();
  });
});

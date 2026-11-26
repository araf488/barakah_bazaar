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

  it('links to the written reviews when given where they are, keeping the full rating in its name', () => {
    renderWithIntl(<RatingSummary rating={{ average: 4.25, count: 3 }} href="#reviews" />);

    const link = screen.getByRole('link', { name: /Rated 4.3 out of 5 from 3 reviews/ });
    expect(link).toHaveAttribute('href', '#reviews');
    expect(link).toHaveTextContent('Read the reviews');
  });

  it('stays plain text, with no link, while there is nothing to read', () => {
    renderWithIntl(<RatingSummary rating={{ average: null, count: 0 }} href="#reviews" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

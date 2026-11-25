import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { OrderStatusBadge } from '../OrderStatusBadge';

describe('OrderStatusBadge', () => {
  it('names the status in words, not colour alone', () => {
    renderWithIntl(<OrderStatusBadge status="DISPATCHED" />);
    expect(screen.getByText('On the way')).toBeInTheDocument();
  });

  it('names the status in Bangla on a Bangla page', () => {
    renderWithIntl(<OrderStatusBadge status="CANCELLED" />, 'bn');
    expect(screen.getByText('বাতিল হয়েছে')).toBeInTheDocument();
  });
});

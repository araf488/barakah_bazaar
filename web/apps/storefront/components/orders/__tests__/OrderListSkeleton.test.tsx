import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { OrderListSkeleton } from '../OrderListSkeleton';

describe('OrderListSkeleton', () => {
  it('tells assistive technology the orders are loading', () => {
    renderWithIntl(<OrderListSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your orders');
  });
});

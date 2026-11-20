import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { OrderFilters } from '../OrderFilters';

describe('OrderFilters', () => {
  it('links each filter to its own address and marks the one shown', () => {
    renderWithIntl(<OrderFilters active="DELIVERED" />);
    const links = screen.getAllByRole('link');

    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['All', '/en/account/orders'],
      ['On the way', '/en/account/orders?status=DISPATCHED'],
      ['Delivered', '/en/account/orders?status=DELIVERED'],
      ['Cancelled', '/en/account/orders?status=CANCELLED'],
    ]);
    expect(screen.getByRole('link', { name: 'Delivered' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
  });
});

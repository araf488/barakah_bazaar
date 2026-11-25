import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OPEN_SEARCH_EVENT } from '../../../lib/searchEvents';
import { renderWithIntl } from '../../../test/intl';
import { Hero } from '../Hero';

describe('Hero', () => {
  it('leads with the Bangla headline on a Bangla page', () => {
    renderWithIntl(<Hero />, 'bn');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('বাংলার সেরাহালাল বাজার।');
  });

  it('leads with the English headline on an English page', () => {
    renderWithIntl(<Hero />, 'en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Halal groceries,delivered to your door.',
    );
  });

  it('opens the search from its one call to action', () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_SEARCH_EVENT, listener);
    renderWithIntl(<Hero />);

    fireEvent.click(screen.getByRole('button', { name: 'Search the bazaar' }));

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_SEARCH_EVENT, listener);
  });

  it('loads its photograph first and describes what it shows', () => {
    renderWithIntl(<Hero />);
    const img = screen.getByRole('img', {
      name: 'Vegetables and green bananas piled high at a market stall',
    });

    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).not.toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('width', '1000');
    expect(img).toHaveAttribute('height', '1200');
  });

  it('states no customer counts, ratings or certification it cannot source', () => {
    renderWithIntl(<Hero />);
    expect(screen.queryByText(/\d+\+|★|certified/i)).not.toBeInTheDocument();
  });
});

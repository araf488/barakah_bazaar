import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OPEN_SEARCH_EVENT } from '../../../lib/searchEvents';
import { renderWithIntl } from '../../../test/intl';
import { PromoPanels } from '../PromoPanels';

describe('PromoPanels', () => {
  const listener = vi.fn();
  afterEach(() => {
    window.removeEventListener(OPEN_SEARCH_EVENT, listener);
    listener.mockClear();
  });

  it.each([
    ['Search doi', 'Doi'],
    ['Search dates', 'Dates'],
  ])('“%s” opens the search with “%s” typed in', (label, query) => {
    window.addEventListener(OPEN_SEARCH_EVENT, listener);
    renderWithIntl(<PromoPanels />);

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ query });
  });

  it('treats its photographs as texture, with empty alt text and reserved space', () => {
    const { container } = renderWithIntl(<PromoPanels />);

    for (const img of container.querySelectorAll('img')) {
      expect(img).toHaveAttribute('alt', '');
      expect(img).toHaveAttribute('width', '800');
      expect(img).toHaveAttribute('loading', 'lazy');
    }
  });

  it('makes no sourcing claim the business has not confirmed', () => {
    renderWithIntl(<PromoPanels />);
    expect(screen.queryByText(/Saudi|imported|same-day/i)).not.toBeInTheDocument();
  });
});

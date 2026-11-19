import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { slot } from '../../../test/checkout';
import { renderWithIntl } from '../../../test/intl';
import { SlotPicker } from '../SlotPicker';

const SLOTS = [
  slot({ slotId: 'evening', startMinute: 1080, endMinute: 1200, remaining: 0 }),
  slot({ slotId: 'morning', startMinute: 600, endMinute: 720, remaining: 2 }),
  slot({ slotId: 'morning', date: '2026-11-21' }),
];

describe('SlotPicker', () => {
  it('starts on "no preferred time", sending no window', () => {
    renderWithIntl(<SlotPicker slots={SLOTS} />);
    const any = screen.getByRole('radio', { name: /No preferred time/ });
    expect(any).toBeChecked();
    expect(any).toHaveAttribute('value', '');
    expect(any).toHaveAttribute('form', 'place-order');
  });

  it('groups windows under their day, in time order', () => {
    renderWithIntl(<SlotPicker slots={SLOTS} />);
    const friday = screen.getByRole('group', { name: 'Fri 20 Nov' });
    const radios = within(friday).getAllByRole('radio');

    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      'morning|2026-11-20',
      'evening|2026-11-20',
    ]);
    expect(screen.getByRole('group', { name: 'Sat 21 Nov' })).toBeInTheDocument();
  });

  it('keeps a full window visible but not choosable, and warns when few places are left', () => {
    renderWithIntl(<SlotPicker slots={SLOTS} />);
    expect(screen.getByRole('radio', { name: /Full/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /2 places left/ })).toBeEnabled();
  });

  it('says when no window is open, leaving "no preferred time"', () => {
    renderWithIntl(<SlotPicker slots={[]} />);
    expect(screen.getByText(/No delivery windows are open this week/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('writes days and times in Bangla on a Bangla page', () => {
    renderWithIntl(<SlotPicker slots={[slot()]} />, 'bn');
    expect(screen.getByRole('radio', { name: /১০:০০/ })).toBeInTheDocument();
  });
});

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { address } from '../../../test/address';
import { renderWithIntl } from '../../../test/intl';

const replace = vi.fn();
vi.mock('../../../i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../i18n/navigation')>()),
  useRouter: () => ({ replace }),
}));

const { AddressChooser } = await import('../AddressChooser');

const HOME = address();
const OFFICE = address({ id: 'addr-2', recipientName: 'Karim', unit: 'Motijheel', area: null });

describe('AddressChooser', () => {
  it('lists each address with its recipient and place, the chosen one checked', () => {
    renderWithIntl(<AddressChooser addresses={[HOME, OFFICE]} selectedId="addr-1" />);

    const home = screen.getByRole('radio', { name: /Tahmina Rahman/ });
    expect(home).toBeChecked();
    expect(home).toHaveAccessibleName(/House 12, Road 4, Banani, Gulshan, Dhaka 1213/);
    expect(screen.getByRole('radio', { name: /Karim/ })).not.toBeChecked();
  });

  it('reloads the page for the address chosen, keeping the scroll position', () => {
    renderWithIntl(<AddressChooser addresses={[HOME, OFFICE]} selectedId="addr-1" />);

    fireEvent.click(screen.getByRole('radio', { name: /Karim/ }));

    expect(replace).toHaveBeenCalledWith(
      { pathname: '/checkout', query: { address: 'addr-2' } },
      { scroll: false },
    );
  });
});

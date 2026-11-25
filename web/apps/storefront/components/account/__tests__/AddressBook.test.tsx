import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { address } from '../../../test/address';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/account/actions', () => ({
  saveAddressAction: vi.fn(),
  deleteAddressAction: vi.fn(),
  setDefaultAddressAction: vi.fn(),
}));
vi.mock('../../../lib/geo', () => ({
  fetchDivisions: vi.fn(async () => [{ nameEn: 'Dhaka', nameBn: 'ঢাকা' }]),
  fetchDistricts: vi.fn(async () => [{ nameEn: 'Dhaka', nameBn: 'ঢাকা' }]),
  fetchUnits: vi.fn(async () => [{ nameEn: 'Gulshan', nameBn: 'গুলশান' }]),
  fetchAreas: vi.fn(async () => [{ nameEn: 'Banani', nameBn: 'বনানী', postCode: '1213' }]),
}));

const { AddressBook } = await import('../AddressBook');
const { saveAddressAction } = await import('../../../lib/account/actions');

const valuesOf = (button: HTMLElement) => Object.fromEntries(new FormData(button.closest('form')!));

describe('AddressBook', () => {
  beforeEach(() => vi.mocked(saveAddressAction).mockReset());

  it('opens the new-address form straight away when there are none', () => {
    renderWithIntl(<AddressBook addresses={[]} />);
    expect(screen.getByText(/No saved addresses yet/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New address' })).toBeInTheDocument();
  });

  it('shows each address with its label, default mark and full place line', () => {
    renderWithIntl(
      <AddressBook
        addresses={[
          address(),
          address({ id: 'addr-2', label: 'Office', isDefault: false, recipientName: 'Karim' }),
        ]}
      />,
    );

    const cards = screen.getAllByRole('listitem');
    expect(within(cards[0]!).getByText('Default')).toBeInTheDocument();
    expect(
      within(cards[0]!).getByText('House 12, Road 4, Banani, Gulshan, Dhaka 1213'),
    ).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Office')).toBeInTheDocument();
  });

  it('offers "make default" only on the others, and removing on all, each naming its recipient', () => {
    renderWithIntl(
      <AddressBook
        addresses={[address(), address({ id: 'addr-2', isDefault: false, recipientName: 'Karim' })]}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Make the address for Tahmina Rahman the default' }),
    ).not.toBeInTheDocument();
    expect(
      valuesOf(screen.getByRole('button', { name: 'Make the address for Karim the default' })),
    ).toEqual({ id: 'addr-2' });
    expect(valuesOf(screen.getByRole('button', { name: 'Remove the address for Karim' }))).toEqual({
      id: 'addr-2',
    });
  });

  it('edits an address in place, with its values filled in', () => {
    renderWithIntl(<AddressBook addresses={[address()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit the address for Tahmina Rahman' }));

    expect(screen.getByRole('heading', { name: 'Edit address' })).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient's name")).toHaveValue('Tahmina Rahman');
    expect(screen.getByLabelText('Post code (optional)')).toHaveValue('1213');
  });

  it('closes the form once the address is saved', async () => {
    vi.mocked(saveAddressAction).mockResolvedValue({ status: 'saved', at: 1 });
    renderWithIntl(<AddressBook addresses={[address()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Add an address/ }));

    await act(async () => {
      fireEvent.submit(screen.getByRole('heading', { name: 'New address' }).closest('form')!);
    });

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'New address' })).not.toBeInTheDocument(),
    );
  });

  it('shows the refusal and marks the field it is about', async () => {
    vi.mocked(saveAddressAction).mockResolvedValue({ status: 'error', error: 'phoneInvalid' });
    renderWithIntl(<AddressBook addresses={[]} />, 'bn');

    await act(async () => {
      fireEvent.submit(screen.getByRole('heading', { name: 'নতুন ঠিকানা' }).closest('form')!);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'বাংলাদেশি মোবাইল নম্বর লিখুন, যেমন ০১৭১২৩৪৫৬৭৮।',
    );
    expect(screen.getByLabelText('মোবাইল নম্বর')).toHaveAttribute('aria-invalid', 'true');
  });

  it('stores the label chips as English words, shown in the reader’s language', () => {
    renderWithIntl(<AddressBook addresses={[]} />, 'bn');
    expect(screen.getByRole('radio', { name: 'অফিস' })).toHaveAttribute('value', 'Office');
    expect(screen.getByRole('radio', { name: 'বাসা' })).toBeChecked();
  });
});

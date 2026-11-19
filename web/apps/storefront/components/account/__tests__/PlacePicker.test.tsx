import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/geo', () => ({
  fetchDivisions: vi.fn(),
  fetchDistricts: vi.fn(),
  fetchUnits: vi.fn(),
  fetchAreas: vi.fn(),
}));

const geo = await import('../../../lib/geo');
const { PlacePicker } = await import('../PlacePicker');

const EMPTY = { division: '', district: '', unit: '', area: '' };
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const choose = async (label: string, value: string) => {
  await waitFor(() =>
    expect(select(label).querySelector(`option[value="${value}"]`)).not.toBeNull(),
  );
  await act(async () => {
    fireEvent.change(select(label), { target: { value } });
  });
};

beforeEach(() => {
  vi.mocked(geo.fetchDivisions)
    .mockReset()
    .mockResolvedValue([{ nameEn: 'Dhaka', nameBn: 'ঢাকা' }]);
  vi.mocked(geo.fetchDistricts)
    .mockReset()
    .mockResolvedValue([{ nameEn: 'Dhaka', nameBn: 'ঢাকা' }]);
  vi.mocked(geo.fetchUnits)
    .mockReset()
    .mockResolvedValue([{ nameEn: 'Gulshan', nameBn: 'গুলশান' }]);
  vi.mocked(geo.fetchAreas)
    .mockReset()
    .mockResolvedValue([{ nameEn: 'Banani', nameBn: 'বনানী', postCode: '1213' }]);
});

describe('PlacePicker', () => {
  it('loads each level once the level above is chosen, and reports the area', async () => {
    const onArea = vi.fn();
    renderWithIntl(
      <PlacePicker
        initial={EMPTY}
        initialUnlisted={false}
        onArea={onArea}
        invalid={false}
        errorId="e"
      />,
    );

    expect(select('District')).toBeDisabled();
    await choose('Division', 'Dhaka');
    expect(geo.fetchDistricts).toHaveBeenCalledWith('Dhaka');
    await choose('District', 'Dhaka');
    await choose('Upazila or thana', 'Gulshan');
    expect(geo.fetchAreas).toHaveBeenCalledWith('Dhaka', 'Gulshan');
    await choose('Area or union (optional)', 'Banani');

    expect(onArea).toHaveBeenCalledWith({ nameEn: 'Banani', nameBn: 'বনানী', postCode: '1213' });
  });

  it('shows Bangla names on a Bangla page while submitting the English ones', async () => {
    renderWithIntl(
      <PlacePicker
        initial={EMPTY}
        initialUnlisted={false}
        onArea={vi.fn()}
        invalid={false}
        errorId="e"
      />,
      'bn',
    );
    await waitFor(() => expect(screen.getByRole('option', { name: 'ঢাকা' })).toHaveValue('Dhaka'));
  });

  it('clears the lower levels when a higher one changes', async () => {
    vi.mocked(geo.fetchDistricts).mockResolvedValue([
      { nameEn: 'Dhaka', nameBn: null },
      { nameEn: 'Gazipur', nameBn: null },
    ]);
    renderWithIntl(
      <PlacePicker
        initial={EMPTY}
        initialUnlisted={false}
        onArea={vi.fn()}
        invalid={false}
        errorId="e"
      />,
    );
    await choose('Division', 'Dhaka');
    await choose('District', 'Dhaka');
    await choose('Upazila or thana', 'Gulshan');

    await choose('District', 'Gazipur');

    expect(select('Upazila or thana').value).toBe('');
  });

  it('offers a retry when a list fails to load', async () => {
    vi.mocked(geo.fetchDivisions).mockRejectedValueOnce(new Error('offline'));
    renderWithIntl(
      <PlacePicker
        initial={EMPTY}
        initialUnlisted={false}
        onArea={vi.fn()}
        invalid={false}
        errorId="e"
      />,
    );

    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => expect(screen.getByRole('option', { name: 'Dhaka' })).toBeInTheDocument());
    expect(geo.fetchDivisions).toHaveBeenCalledTimes(2);
  });

  it('turns upazila and area into free text when the area is not listed', async () => {
    renderWithIntl(
      <PlacePicker
        initial={EMPTY}
        initialUnlisted={false}
        onArea={vi.fn()}
        invalid={false}
        errorId="e"
      />,
    );

    fireEvent.click(screen.getByLabelText('My area is not in the list'));

    expect(screen.getByLabelText('Upazila, thana or area name').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Area (optional)').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Division').tagName).toBe('SELECT');
  });

  it('marks the missing levels when the form says the place is incomplete', async () => {
    renderWithIntl(
      <PlacePicker initial={EMPTY} initialUnlisted={false} onArea={vi.fn()} invalid errorId="e" />,
    );
    expect(select('Division')).toHaveAttribute('aria-invalid', 'true');
    expect(select('Division')).toHaveAttribute('aria-describedby', 'e');
  });
});

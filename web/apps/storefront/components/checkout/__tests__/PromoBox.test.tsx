import { cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/checkout/actions', () => ({}));

const { PromoBox } = await import('../PromoBox');

const PROMO = { code: 'EID10', nameEn: 'Eid offer', nameBn: null, discountPoysha: 25000 };
const valuesOf = (button: HTMLElement) => Object.fromEntries(new FormData(button.closest('form')!));

describe('PromoBox', () => {
  it('sends the code with the amounts it should be checked against', () => {
    const action = vi.fn();
    renderWithIntl(
      <PromoBox
        state={{ status: 'idle' }}
        action={action}
        pending={false}
        subtotalPoysha={250000}
        deliveryFeePoysha={6000}
      />,
    );
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'eid10' } });

    expect(valuesOf(screen.getByRole('button', { name: 'Apply' }))).toEqual({
      code: 'eid10',
      subtotalPoysha: '250000',
      deliveryFeePoysha: '6000',
    });
  });

  it('marks the field and says why a code was refused', () => {
    renderWithIntl(
      <PromoBox
        state={{ status: 'error', error: 'promoUsedUp' }}
        action={vi.fn()}
        pending={false}
        subtotalPoysha={1}
        deliveryFeePoysha={0}
      />,
    );
    const field = screen.getByLabelText('Promo code');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('This promo code has been fully claimed.');
  });

  it('shows an applied code with its saving and a way to remove it', () => {
    renderWithIntl(
      <PromoBox
        state={{ status: 'applied', promo: PROMO }}
        action={vi.fn()}
        pending={false}
        subtotalPoysha={1}
        deliveryFeePoysha={0}
      />,
    );
    expect(screen.getByText(/EID10 applied: ৳250.00 off./)).toBeInTheDocument();
    expect(screen.getByText('Eid offer')).toBeInTheDocument();
    expect(valuesOf(screen.getByRole('button', { name: 'Remove promo code EID10' }))).toEqual({
      intent: 'remove',
    });
  });

  it('keeps a refused code in the field to correct, and says while it is checking', () => {
    const action = vi.fn();
    renderWithIntl(
      <PromoBox
        state={{ status: 'idle' }}
        action={action}
        pending={false}
        subtotalPoysha={1}
        deliveryFeePoysha={0}
      />,
    );
    const field = screen.getByLabelText('Promo code');
    fireEvent.change(field, { target: { value: 'EID1' } });
    fireEvent.submit(field.closest('form')!);

    expect(action).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue('EID1');
    cleanup();
    renderWithIntl(
      <PromoBox
        state={{ status: 'idle' }}
        action={action}
        pending
        subtotalPoysha={1}
        deliveryFeePoysha={0}
      />,
    );
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  });
});

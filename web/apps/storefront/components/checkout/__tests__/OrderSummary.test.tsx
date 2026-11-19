import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cartItem, serverCart } from '../../../test/cart';
import { quote } from '../../../test/checkout';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/checkout/actions', () => ({
  previewPromoAction: vi.fn(),
  placeOrderAction: vi.fn(),
}));

const { OrderSummary } = await import('../OrderSummary');
const { previewPromoAction, placeOrderAction } = await import('../../../lib/checkout/actions');
const { fromServerCart } = await import('../../../lib/cart/view');

const CART = fromServerCart(serverCart());
const QUOTE = { ok: true as const, quote: quote({ feePoysha: 6000 }) };
const PROMO = { code: 'EID10', nameEn: 'Eid offer', nameBn: null, discountPoysha: 25000 };
const placeButton = () => screen.getByRole('button', { name: 'Place order' });

beforeEach(() => vi.clearAllMocks());

describe('OrderSummary', () => {
  it('lists the lines and adds the delivery fee to the total', () => {
    renderWithIntl(<OrderSummary cart={CART} addressId="addr-1" quote={QUOTE} blocker={null} />);

    expect(screen.getByText('Ajwa Dates')).toBeInTheDocument();
    expect(screen.getByText('2 × 500g')).toBeInTheDocument();
    expect(screen.getByText('৳60.00', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('৳2,560.00', { selector: 'dd' })).toBeInTheDocument();
    expect(placeButton()).toHaveAccessibleDescription('You pay ৳2,560.00 in cash when it arrives.');
  });

  it('says delivery is free, or how much more makes it free', () => {
    const { unmount } = renderWithIntl(
      <OrderSummary
        cart={CART}
        addressId="addr-1"
        quote={{ ok: true, quote: quote({ isFree: true, feePoysha: 0 }) }}
        blocker={null}
      />,
    );
    expect(screen.getByText('Free', { selector: 'dd' })).toBeInTheDocument();
    unmount();

    renderWithIntl(
      <OrderSummary
        cart={CART}
        addressId="addr-1"
        quote={{ ok: true, quote: quote({ freeDeliveryShortfallPoysha: 50000 }) }}
        blocker={null}
      />,
    );
    expect(screen.getByText('Add ৳500.00 more for free delivery.')).toBeInTheDocument();
  });

  it('sends the address, and the price confirmation only when prices moved', () => {
    const moved = fromServerCart(serverCart([cartItem({ priceChanged: true })]));
    renderWithIntl(<OrderSummary cart={moved} addressId="addr-1" quote={QUOTE} blocker={null} />);

    expect(screen.getByText(/Some prices changed since you added them/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /I have seen the new prices/ }));
    expect(Object.fromEntries(new FormData(placeButton().closest('form')!))).toEqual({
      addressId: 'addr-1',
      acceptPriceChanges: 'on',
    });
  });

  it('takes an applied code off the total and sends it with the order', async () => {
    vi.mocked(previewPromoAction).mockResolvedValue({ status: 'applied', promo: PROMO });
    renderWithIntl(<OrderSummary cart={CART} addressId="addr-1" quote={QUOTE} blocker={null} />);

    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'eid10' } });
    fireEvent.submit(screen.getByLabelText('Promo code').closest('form')!);

    await waitFor(() => expect(screen.getByText('Promo EID10')).toBeInTheDocument());
    expect(screen.getByText('৳2,310.00', { selector: 'dd' })).toBeInTheDocument();
    expect(new FormData(placeButton().closest('form')!).get('promotionCode')).toBe('EID10');
  });

  it('disables placing with the reason shown when the order cannot go through', () => {
    renderWithIntl(<OrderSummary cart={CART} addressId="addr-1" quote={QUOTE} blocker="noZone" />);

    expect(placeButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('We do not deliver to that area yet.');
  });

  it('shows why the API refused the order', async () => {
    vi.mocked(placeOrderAction).mockResolvedValue({ status: 'error', error: 'slotGone', at: 1 });
    renderWithIntl(<OrderSummary cart={CART} addressId="addr-1" quote={QUOTE} blocker={null} />);

    fireEvent.submit(placeButton().closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That delivery time just filled up. Choose another one.',
    );
  });

  it('keeps what the shopper chose after a refusal, so the order can be sent again', async () => {
    vi.mocked(placeOrderAction).mockResolvedValue({ status: 'error', error: 'failed', at: 1 });
    const moved = fromServerCart(serverCart([cartItem({ priceChanged: true })]));
    renderWithIntl(<OrderSummary cart={moved} addressId="addr-1" quote={QUOTE} blocker={null} />);
    const confirm = screen.getByRole('checkbox', { name: /I have seen the new prices/ });
    fireEvent.click(confirm);

    fireEvent.submit(placeButton().closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not work.');
    expect(confirm).toBeChecked();
    expect(vi.mocked(placeOrderAction).mock.calls[0]?.[1].get('acceptPriceChanges')).toBe('on');
  });

  it('shows the delivery fee as unavailable when the quote failed', () => {
    renderWithIntl(<OrderSummary cart={CART} addressId="addr-1" quote={null} blocker={null} />);
    expect(screen.getByText('Not available', { selector: 'dd' })).toBeInTheDocument();
  });

  it('writes amounts in Bengali digits on a Bangla page', () => {
    renderWithIntl(
      <OrderSummary cart={CART} addressId="addr-1" quote={QUOTE} blocker={null} />,
      'bn',
    );
    expect(screen.getByText('৳২,৫৬০.০০', { selector: 'dd' })).toBeInTheDocument();
  });
});

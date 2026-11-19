import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/cart/actions', () => ({ addToCartAction: vi.fn() }));

const { AddToCart } = await import('../AddToCart');
const { addToCartAction } = await import('../../../lib/cart/actions');
const { OPEN_CART_EVENT } = await import('../../../lib/cartEvents');

const submit = async () => {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Add to cart' }).closest('form')!);
  });
};

describe('AddToCart', () => {
  beforeEach(() => vi.mocked(addToCartAction).mockReset());

  it('starts at one and steps between 1 and 99', () => {
    const { container } = renderWithIntl(
      <AddToCart slug="ajwa" variantId="v1" priceLabel="৳1,250.00" />,
    );
    const quantity = () => container.querySelector('input[name="quantity"]');

    expect(quantity()).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(quantity()).toHaveValue('2');
  });

  it('opens the cart drawer once the line is added, and says so', async () => {
    vi.mocked(addToCartAction).mockResolvedValue({ status: 'added', at: 1 });
    const listener = vi.fn();
    window.addEventListener(OPEN_CART_EVENT, listener);
    const { container } = renderWithIntl(
      <AddToCart slug="ajwa" variantId="v1" priceLabel="৳1,250.00" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));

    await submit();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input[name="quantity"]')).toHaveValue('1');
    expect(screen.getByRole('status')).toHaveTextContent('Added to your cart');
    window.removeEventListener(OPEN_CART_EVENT, listener);
  });

  it('explains a refusal', async () => {
    vi.mocked(addToCartAction).mockResolvedValue({ status: 'error', error: 'stock' });
    renderWithIntl(<AddToCart slug="ajwa" variantId="v1" priceLabel="৳1,250.00" />, 'bn');

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'কার্টে যোগ করুন' }).closest('form')!);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('এই পরিমাণের জন্য যথেষ্ট স্টক নেই।');
  });

  it('shows a sticky bar with the price once the main button scrolls away, submitting the same form', () => {
    let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = renderWithIntl(
      <AddToCart slug="ajwa" variantId="v1" priceLabel="৳1,250.00" />,
    );
    expect(screen.queryByText('৳1,250.00')).not.toBeInTheDocument();

    act(() => notify([{ isIntersecting: false }]));

    expect(screen.getByText('৳1,250.00')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Add to cart' });
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toHaveAttribute('form', container.querySelector('form')?.id);

    act(() => notify([{ isIntersecting: true }]));
    expect(screen.queryByText('৳1,250.00')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

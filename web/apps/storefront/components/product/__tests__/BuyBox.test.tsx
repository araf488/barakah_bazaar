import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/cart/actions', () => ({ addToCartAction: vi.fn() }));
import { productDetail, variant } from '../../../test/productDetail';
import { BuyBox } from '../BuyBox';

const VARIANTS = productDetail().variants;

describe('BuyBox', () => {
  it('opens on the default size and shows its price', () => {
    renderWithIntl(<BuyBox slug="ajwa-dates" variants={VARIANTS} />);

    expect(screen.getByRole('radio', { name: /500g/ })).toBeChecked();
    expect(screen.getByText('৳1,250.00', { selector: '.font-display' })).toBeInTheDocument();
    expect(screen.getByText('per 500g')).toBeInTheDocument();
  });

  it('updates the price when another size is chosen', () => {
    renderWithIntl(<BuyBox slug="ajwa-dates" variants={VARIANTS} />);

    fireEvent.click(screen.getByRole('radio', { name: /250g/ }));

    expect(screen.getByRole('radio', { name: /250g/ })).toBeChecked();
    expect(screen.getByText('৳650.00', { selector: '.font-display' })).toBeInTheDocument();
    expect(screen.getByText('per 250g')).toBeInTheDocument();
  });

  it('names the size group and each size, in the reader’s language', () => {
    renderWithIntl(<BuyBox slug="ajwa-dates" variants={VARIANTS} />, 'bn');

    expect(screen.getByRole('group', { name: 'সাইজ বেছে নিন' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /আজওয়া খেজুর ৫০০ গ্রাম/ })).toBeInTheDocument();
  });

  it('offers no choice when there is only one size', () => {
    renderWithIntl(<BuyBox slug="ajwa-dates" variants={[variant()]} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('per 500g')).toBeInTheDocument();
  });

  it('shows the compare-at price and the saving when the size is reduced', () => {
    renderWithIntl(
      <BuyBox
        slug="ajwa-dates"
        variants={[
          variant({
            pricePoysha: 100000,
            priceFormatted: '৳1,000.00',
            compareAtPricePoysha: 120000,
          }),
        ]}
      />,
    );

    expect(screen.getByText('Was ৳1,200.00')).toBeInTheDocument();
    expect(screen.getByText('Save 17%')).toBeInTheDocument();
  });

  it('shows no saving without a higher compare-at price', () => {
    renderWithIntl(
      <BuyBox slug="ajwa-dates" variants={[variant({ compareAtPricePoysha: 125000 })]} />,
    );
    expect(screen.queryByText(/Save|Was/)).not.toBeInTheDocument();
  });

  it('announces price changes', () => {
    const { container } = renderWithIntl(<BuyBox slug="ajwa-dates" variants={VARIANTS} />);
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('৳1,250.00');
  });

  it('renders nothing for a product with no sizes', () => {
    const { container } = renderWithIntl(<BuyBox slug="ajwa-dates" variants={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('adds the selected size to the cart', () => {
    const { container } = renderWithIntl(<BuyBox slug="ajwa-dates" variants={VARIANTS} />);

    fireEvent.click(screen.getByRole('radio', { name: /250g/ }));

    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeInTheDocument();
    expect(container.querySelector('input[name="variantId"]')).toHaveValue('v-250');
    expect(container.querySelector('input[name="slug"]')).toHaveValue('ajwa-dates');
  });
});

import { screen, within } from '@testing-library/react';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ProductReviewsResult, PublishedReview } from '../../../lib/reviews/api';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/reviews/api', () => ({ getProductReviews: vi.fn() }));

const { ProductReviews, ReviewsSection } = await import('../ProductReviews');
const { getProductReviews } = await import('../../../lib/reviews/api');

const review = (id: string, overrides: Partial<PublishedReview> = {}): PublishedReview => ({
  id,
  productId: 'prod-1',
  rating: 4,
  title: 'Sweet and soft',
  body: 'Packed well.\nArrived the next morning.',
  isVerifiedPurchase: true,
  createdAt: '2026-11-20T08:00:00.000Z',
  ...overrides,
});
const page = (items: PublishedReview[], total = items.length): ProductReviewsResult => ({
  ok: true,
  page: { items, total, page: 1, pageSize: 6 },
});
const RATED = { average: 4.5, count: 2 };
const draw = (result: ProductReviewsResult, shown = 6, locale: 'en' | 'bn' = 'en') =>
  renderWithIntl(
    <ReviewsSection
      productId="prod-1"
      slug="ajwa-dates"
      rating={RATED}
      shown={shown}
      result={result}
    />,
    locale,
  );

describe('ProductReviews', () => {
  it('asks for as many reviews as the page shows, then draws them', async () => {
    const result = page([review('r1')]);
    vi.mocked(getProductReviews).mockResolvedValue(result);

    const element = await ProductReviews({
      productId: 'prod-1',
      slug: 'ajwa-dates',
      rating: RATED,
      shown: 12,
    });

    expect(getProductReviews).toHaveBeenCalledWith('prod-1', 12);
    expect(isValidElement(element) && element.type).toBe(ReviewsSection);
    expect(isValidElement(element) && (element.props as { result: unknown }).result).toBe(result);
  });
});

describe('ReviewsSection', () => {
  it('lists each review with its stars read out, its date and the verified mark', () => {
    draw(page([review('r1'), review('r2', { rating: 5, title: null, body: 'Excellent.' })]));

    const section = screen.getByRole('region', { name: 'Customer reviews' });
    expect(section).toHaveAttribute('id', 'reviews');
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Rated 4 out of 5')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('heading', { name: 'Sweet and soft' })).toBeInTheDocument();
    expect(within(items[0]!).getByText(/Arrived the next morning/)).toBeInTheDocument();
    expect(within(items[0]!).getByText('20 Nov 2026')).toHaveAttribute(
      'datetime',
      '2026-11-20T08:00:00.000Z',
    );
    expect(within(items[0]!).getByText('Verified purchase')).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('heading')).not.toBeInTheDocument();
  });

  it('shows the average beside the heading, read out in full', () => {
    draw(page([review('r1')]));

    expect(screen.getByText('Rated 4.5 out of 5 from 2 reviews')).toBeInTheDocument();
    expect(screen.getByText('2 reviews')).toBeInTheDocument();
  });

  it('says how reviews get here, a claim the API guarantees', () => {
    draw(page([]));

    expect(
      screen.getByText(
        'Every review comes from a delivered Barakah Bazaar order and is read by our team before it appears.',
      ),
    ).toBeInTheDocument();
  });

  it('offers six more through a link that keeps working without JavaScript', () => {
    draw(page([review('r1'), review('r2')], 9), 6);

    expect(screen.getByRole('link', { name: 'Show more reviews' })).toHaveAttribute(
      'href',
      '/en/p/ajwa-dates?reviews=2#reviews',
    );
    expect(screen.getByText('Showing 2 of 9')).toBeInTheDocument();
  });

  it('offers no more once every review is shown', () => {
    draw(page([review('r1'), review('r2')], 2));

    expect(screen.queryByRole('link', { name: 'Show more reviews' })).not.toBeInTheDocument();
  });

  it('says there are no written reviews yet, and how one gets written', () => {
    draw(page([]));

    expect(screen.getByText('No written reviews yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Customers who received this product can review it from their account.'),
    ).toBeInTheDocument();
  });

  it('shows an error with a retry, not an empty list, when the reviews cannot be loaded', () => {
    draw({ ok: false }, 12);

    expect(screen.getByRole('alert')).toHaveTextContent('Reviews could not be loaded just now.');
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/en/p/ajwa-dates?reviews=2#reviews',
    );
    expect(screen.queryByText('No written reviews yet.')).not.toBeInTheDocument();
  });

  it('reads in Bangla with Bengali digits', () => {
    draw(page([review('r1')], 1), 6, 'bn');

    expect(screen.getByRole('heading', { name: 'ক্রেতাদের রিভিউ' })).toBeInTheDocument();
    expect(screen.getByText('৫-এর মধ্যে ৪')).toBeInTheDocument();
    expect(screen.getByText('যাচাই করা ক্রেতা')).toBeInTheDocument();
  });
});

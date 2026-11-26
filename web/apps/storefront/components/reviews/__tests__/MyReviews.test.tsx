import { fireEvent, screen, within } from '@testing-library/react';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AwaitingReview, MyReview, MyReviewsResult } from '../../../lib/reviews/api';
import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/reviews/api', () => ({ getMyReviews: vi.fn() }));
vi.mock('../../../lib/reviews/actions', () => ({ submitReviewAction: vi.fn() }));

const { MyReviews, MyReviewsView, MyReviewsSkeleton } = await import('../MyReviews');
const { getMyReviews } = await import('../../../lib/reviews/api');

const awaiting = (overrides: Partial<AwaitingReview> = {}): AwaitingReview => ({
  orderItemId: 'line-1',
  productId: 'prod-1',
  productSlug: 'ajwa-dates',
  productNameEn: 'Ajwa Dates',
  productNameBn: 'আজওয়া খেজুর',
  variantNameEn: '1 kg',
  imageUrl: 'https://img.example/ajwa.webp',
  orderNumber: 'BB-20261120-000042',
  deliveredAt: '2026-11-20T08:00:00.000Z',
  ...overrides,
});
const mine = (overrides: Partial<MyReview> = {}): MyReview => ({
  id: 'rev-1',
  productId: 'prod-2',
  rating: 5,
  title: 'Creamy',
  body: 'Still cold on arrival.',
  isVerifiedPurchase: true,
  createdAt: '2026-11-21T08:00:00.000Z',
  status: 'PENDING',
  productSlug: 'mishti-doi',
  productNameEn: 'Mishti Doi',
  productNameBn: 'মিষ্টি দই',
  imageUrl: null,
  ...overrides,
});
const ok = (awaitingItems: AwaitingReview[], reviews: MyReview[]): MyReviewsResult => ({
  ok: true,
  mine: { awaiting: awaitingItems, reviews },
});
const draw = (outcome: MyReviewsResult, locale: 'en' | 'bn' = 'en') =>
  renderWithIntl(<MyReviewsView outcome={outcome} />, locale);

describe('MyReviews', () => {
  it('loads the lists and hands them to the view', async () => {
    const outcome = ok([], []);
    vi.mocked(getMyReviews).mockResolvedValue(outcome);

    const element = await MyReviews();

    expect(isValidElement(element) && element.type).toBe(MyReviewsView);
    expect(isValidElement(element) && (element.props as { outcome: unknown }).outcome).toBe(
      outcome,
    );
  });
});

describe('MyReviewsView', () => {
  it('lists each product waiting for a review, linking to it, with its order and delivery', () => {
    draw(ok([awaiting()], []));

    const section = screen.getByRole('region', { name: /Waiting for your review/ });
    expect(within(section).getByText('1 product')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Ajwa Dates' })).toHaveAttribute(
      'href',
      '/en/p/ajwa-dates',
    );
    expect(within(section).getByText('1 kg · Delivered 20 Nov 2026')).toBeInTheDocument();
    expect(within(section).getByText('BB-20261120-000042')).toHaveAttribute('dir', 'ltr');
  });

  it('folds the form under a "write a review" control named after the product', () => {
    const { container } = draw(ok([awaiting()], []));

    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    const summary = screen.getByText('Write a review').closest('summary')!;
    expect(summary).toHaveAttribute('aria-label', 'Write a review of Ajwa Dates');

    fireEvent.click(summary);

    expect(container.querySelector('input[name="orderItemId"]')).toHaveValue('line-1');
  });

  it('shows each own review with its status in words, and why it is not public yet', () => {
    draw(ok([], [mine(), mine({ id: 'rev-2', status: 'PUBLISHED', title: null })]));

    const items = within(screen.getByRole('region', { name: 'Your reviews' })).getAllByRole(
      'listitem',
    );
    expect(within(items[0]!).getByText('Being checked')).toBeInTheDocument();
    expect(
      within(items[0]!).getByText(
        'Our team reads every review before it appears on the product page.',
      ),
    ).toBeInTheDocument();
    expect(within(items[0]!).getByText('Rated 5 out of 5')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Written 21 Nov 2026')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'Mishti Doi' })).toHaveAttribute(
      'href',
      '/en/p/mishti-doi',
    );
    expect(within(items[1]!).getByText('Published')).toBeInTheDocument();
    expect(within(items[1]!).queryByText(/Our team reads/)).not.toBeInTheDocument();
  });

  it('says plainly when a review was not published, with no reason the API never gives', () => {
    draw(ok([], [mine({ status: 'REJECTED' })]));

    expect(screen.getByText('Not published')).toBeInTheDocument();
    expect(screen.getByText('This review was not added to the product page.')).toBeInTheDocument();
  });

  it('leaves out a section with nothing in it', () => {
    draw(ok([], [mine()]));

    expect(
      screen.queryByRole('region', { name: /Waiting for your review/ }),
    ).not.toBeInTheDocument();
  });

  it('says what will appear here when there is nothing yet', () => {
    draw(ok([], []));

    expect(
      screen.getByText('Nothing to review yet. Products from your delivered orders appear here.'),
    ).toBeInTheDocument();
  });

  it('shows an error with a retry, not an empty page, when the lists cannot be loaded', () => {
    draw({ ok: false });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your reviews could not be loaded just now.',
    );
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/en/account/reviews',
    );
  });

  it('names products in Bangla on the Bangla page', () => {
    draw(ok([awaiting()], []), 'bn');

    expect(screen.getByRole('link', { name: 'আজওয়া খেজুর' })).toBeInTheDocument();
    expect(screen.getByText('১টি পণ্য')).toBeInTheDocument();
  });
});

describe('MyReviewsSkeleton', () => {
  it('announces that it is loading and hides its placeholder shapes', () => {
    renderWithIntl(<MyReviewsSkeleton label="Loading your reviews…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your reviews…');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

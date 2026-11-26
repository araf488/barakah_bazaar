import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('../../../lib/reviews/actions', () => ({ submitReviewAction: vi.fn() }));

const { ReviewForm } = await import('../ReviewForm');
const { submitReviewAction } = await import('../../../lib/reviews/actions');

const submit = () =>
  fireEvent.submit(screen.getByRole('button', { name: 'Send review' }).closest('form')!);

beforeEach(() => vi.clearAllMocks());

describe('ReviewForm', () => {
  it('offers one to five stars as one labelled radio group', () => {
    renderWithIntl(<ReviewForm orderItemId="line-1" />);

    const group = screen.getByRole('group', { name: 'Your rating' });
    const stars = screen.getAllByRole('radio');
    expect(group).toContainElement(stars[0]!);
    expect(stars.map((star) => star.getAttribute('value'))).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '5 stars' })).toBeInTheDocument();
  });

  it('says in words what the chosen rating means', () => {
    renderWithIntl(<ReviewForm orderItemId="line-1" />);

    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));

    expect(screen.getByRole('radio', { name: '4 stars' })).toBeChecked();
    expect(screen.getByText('4 out of 5: Very good')).toBeInTheDocument();
  });

  it('sends the line, the rating and the text under the names the action reads', async () => {
    vi.mocked(submitReviewAction).mockResolvedValue({ status: 'idle' });
    renderWithIntl(<ReviewForm orderItemId="line-1" />);

    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.change(screen.getByLabelText('Headline (optional)'), {
      target: { value: 'Fresh' },
    });
    fireEvent.change(screen.getByLabelText('Your review (optional)'), {
      target: { value: 'Still cold on arrival.' },
    });
    submit();

    await waitFor(() => expect(submitReviewAction).toHaveBeenCalled());
    expect(Object.fromEntries(vi.mocked(submitReviewAction).mock.calls[0]![1])).toEqual({
      orderItemId: 'line-1',
      rating: '5',
      title: 'Fresh',
      body: 'Still cold on arrival.',
    });
  });

  it('counts the characters of the text against its limit', () => {
    renderWithIntl(<ReviewForm orderItemId="line-1" />);

    fireEvent.change(screen.getByLabelText('Your review (optional)'), {
      target: { value: 'Good' },
    });

    expect(screen.getByText('4 of 2,000 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Your review (optional)')).toHaveAttribute('maxlength', '2000');
    expect(screen.getByLabelText('Headline (optional)')).toHaveAttribute('maxlength', '120');
  });

  it('points the rating group at the error when no rating was chosen', async () => {
    vi.mocked(submitReviewAction).mockResolvedValue({
      status: 'error',
      error: 'ratingMissing',
      at: 1,
    });
    renderWithIntl(<ReviewForm orderItemId="line-1" />);

    submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Choose a rating from 1 to 5 stars.');
    expect(screen.getByRole('group', { name: 'Your rating' })).toHaveAttribute(
      'aria-describedby',
      alert.id,
    );
  });

  it('keeps what was typed after a refusal', async () => {
    vi.mocked(submitReviewAction).mockResolvedValue({
      status: 'error',
      error: 'alreadyReviewed',
      at: 1,
    });
    renderWithIntl(<ReviewForm orderItemId="line-1" />);
    fireEvent.click(screen.getByRole('radio', { name: '3 stars' }));
    fireEvent.change(screen.getByLabelText('Your review (optional)'), {
      target: { value: 'Fine.' },
    });

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have already reviewed this item.',
    );
    expect(screen.getByLabelText('Your review (optional)')).toHaveValue('Fine.');
    expect(screen.getByRole('radio', { name: '3 stars' })).toBeChecked();
  });

  it('shows its progress label while the review is on its way', async () => {
    let finish: (state: { status: 'idle' }) => void = () => undefined;
    vi.mocked(submitReviewAction).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderWithIntl(<ReviewForm orderItemId="line-1" />);
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));

    submit();

    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    finish({ status: 'idle' });
    expect(await screen.findByRole('button', { name: 'Send review' })).toBeEnabled();
  });

  it('reads in Bangla, digits included', () => {
    renderWithIntl(<ReviewForm orderItemId="line-1" />, 'bn');

    fireEvent.click(screen.getByRole('radio', { name: '২টি তারা' }));

    expect(screen.getByText('৫-এর মধ্যে ২: মোটামুটি')).toBeInTheDocument();
    expect(screen.getByText('২,০০০টির মধ্যে ০টি অক্ষর')).toBeInTheDocument();
  });
});

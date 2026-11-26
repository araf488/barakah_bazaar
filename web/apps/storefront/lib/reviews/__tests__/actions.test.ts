import { beforeEach, describe, expect, it, vi } from 'vitest';

const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'bn') }));
vi.mock('../../../i18n/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../account/caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../api', () => ({ reviewsApi: { create: vi.fn() } }));

const { submitReviewAction } = await import('../actions');
const { accountCaller } = await import('../../account/caller');
const { reviewsApi } = await import('../api');
const { redirect } = await import('../../../i18n/navigation');

const CALLER = { deviceId: 'd', accessToken: 'at' };
const IDLE = { status: 'idle' } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const VALID = {
  orderItemId: 'line-1',
  rating: '4',
  title: '  Sweet and fresh ',
  body: ' Packed well. ',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
});

describe('submitReviewAction', () => {
  it('sends the trimmed review and reloads the page with a thank-you', async () => {
    vi.mocked(reviewsApi.create).mockResolvedValue({ ok: true, data: {} as never });

    await expect(submitReviewAction(IDLE, form(VALID))).rejects.toBe(REDIRECTED);

    expect(reviewsApi.create).toHaveBeenCalledWith(CALLER, {
      orderItemId: 'line-1',
      rating: 4,
      title: 'Sweet and fresh',
      body: 'Packed well.',
    });
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/account/reviews', query: { sent: '1' } },
      locale: 'bn',
    });
  });

  it('leaves out an empty headline and text rather than sending blanks', async () => {
    vi.mocked(reviewsApi.create).mockResolvedValue({ ok: true, data: {} as never });

    await expect(
      submitReviewAction(IDLE, form({ orderItemId: 'line-1', rating: '5', title: ' ', body: '' })),
    ).rejects.toBe(REDIRECTED);

    expect(reviewsApi.create).toHaveBeenCalledWith(CALLER, { orderItemId: 'line-1', rating: 5 });
  });

  it('sends a line break as one character, as the form counted it', async () => {
    vi.mocked(reviewsApi.create).mockResolvedValue({ ok: true, data: {} as never });

    await expect(
      submitReviewAction(IDLE, form({ ...VALID, body: 'Chilled.\r\nNot too sweet.\r' })),
    ).rejects.toBe(REDIRECTED);

    expect(vi.mocked(reviewsApi.create).mock.calls[0]![1].body).toBe('Chilled.\nNot too sweet.');
  });

  it('asks for a rating before calling the API', async () => {
    const state = await submitReviewAction(IDLE, form({ ...VALID, rating: '' }));

    expect(state).toMatchObject({ status: 'error', error: 'ratingMissing' });
    expect(reviewsApi.create).not.toHaveBeenCalled();
  });

  it('says the session ended when there is no caller', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);

    await expect(submitReviewAction(IDLE, form(VALID))).resolves.toMatchObject({
      status: 'error',
      error: 'signedOut',
    });
    expect(reviewsApi.create).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'You have already reviewed this item.', 'alreadyReviewed'],
    [409, 'You can review this once it has been delivered.', 'notDelivered'],
    [404, 'You can only review something you have received.', 'notReceived'],
    [503, 'Could not save your review. Please try again.', 'failed'],
  ])('names a %i refusal (%s) as %s, without leaving the page', async (status, message, error) => {
    vi.mocked(reviewsApi.create).mockResolvedValue({ ok: false, status, message });

    await expect(submitReviewAction(IDLE, form(VALID))).resolves.toMatchObject({
      status: 'error',
      error,
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});

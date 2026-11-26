import { describe, expect, it } from 'vitest';

import { checkReview, RATINGS, reviewErrorOf, reviewsToShow } from '../rules';

const valid = { orderItemId: 'line-1', rating: 4, title: 'Good', body: 'Fresh.' };

describe('checkReview', () => {
  it('lets a rating with no title or text through', () => {
    expect(checkReview({ ...valid, title: '', body: '' })).toBeNull();
  });

  it.each([Number.NaN, 0, 6, 2.5])('asks for a rating when it is %s', (rating) => {
    expect(checkReview({ ...valid, rating })).toBe('ratingMissing');
  });

  it('reads a missing order line as a broken form, not a missing rating', () => {
    expect(checkReview({ ...valid, orderItemId: '' })).toBe('invalid');
  });

  it('refuses a headline over 120 characters and text over 2,000', () => {
    expect(checkReview({ ...valid, title: 'x'.repeat(120) })).toBeNull();
    expect(checkReview({ ...valid, title: 'x'.repeat(121) })).toBe('titleLong');
    expect(checkReview({ ...valid, body: 'x'.repeat(2000) })).toBeNull();
    expect(checkReview({ ...valid, body: 'x'.repeat(2001) })).toBe('bodyLong');
  });
});

describe('reviewErrorOf', () => {
  it('tells the two 409s apart by their message', () => {
    expect(reviewErrorOf(409, 'You can review this once it has been delivered.')).toBe(
      'notDelivered',
    );
    expect(reviewErrorOf(409, 'You have already reviewed this item.')).toBe('alreadyReviewed');
  });

  it('reads an unknown 409, or an inherited key such as "constructor", as a failure', () => {
    expect(reviewErrorOf(409, 'Something else.')).toBe('failed');
    expect(reviewErrorOf(409, 'constructor')).toBe('failed');
    expect(reviewErrorOf(409, null)).toBe('failed');
  });

  it.each([
    [400, 'invalid'],
    [401, 'signedOut'],
    [404, 'notReceived'],
    [429, 'tooMany'],
    [503, 'failed'],
    [0, 'failed'],
  ])('reads %i as %s', (status, error) => {
    expect(reviewErrorOf(status, null)).toBe(error);
  });
});

describe('reviewsToShow', () => {
  it('shows six at first, and six more per step', () => {
    expect(reviewsToShow(undefined)).toBe(6);
    expect(reviewsToShow('2')).toBe(12);
    expect(reviewsToShow(['3', '9'])).toBe(18);
  });

  it('reads anything unusable as the first step', () => {
    expect(reviewsToShow('abc')).toBe(6);
    expect(reviewsToShow('-4')).toBe(6);
    expect(reviewsToShow('0')).toBe(6);
  });

  it('never asks for more than the API allows in one page', () => {
    expect(reviewsToShow('999')).toBe(100);
  });
});

describe('RATINGS', () => {
  it('runs from one to five stars', () => {
    expect(RATINGS).toEqual([1, 2, 3, 4, 5]);
  });
});

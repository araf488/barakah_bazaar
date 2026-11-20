import { describe, expect, it } from 'vitest';

import { cancelErrorFor } from '../errors';

describe('cancelErrorFor', () => {
  it('tells the 409 refusals apart by their message', () => {
    expect(
      cancelErrorFor(
        409,
        'This order has already been dispatched and can no longer be cancelled. Contact support.',
      ),
    ).toBe('tooLate');
    expect(cancelErrorFor(409, 'An order cannot go from PICKING to CANCELLED.')).toBe('tooLate');
    expect(
      cancelErrorFor(
        409,
        'This order changed while you were working on it. Reload it and try again.',
      ),
    ).toBe('changed');
  });

  it('falls back to the status when the message is unknown or missing', () => {
    expect(cancelErrorFor(401, 'Missing access token')).toBe('signedOut');
    expect(cancelErrorFor(404, 'Order not found')).toBe('gone');
    expect(cancelErrorFor(503, null)).toBe('unavailable');
    expect(cancelErrorFor(0, null)).toBe('unavailable');
    expect(cancelErrorFor(409, 'Something new')).toBe('failed');
    expect(cancelErrorFor(500, null)).toBe('failed');
  });
});

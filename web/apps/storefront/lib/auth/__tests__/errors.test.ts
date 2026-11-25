import { describe, expect, it } from 'vitest';

import { authErrorFor } from '../errors';

describe('authErrorFor', () => {
  it.each([
    [400, 'invalid'],
    [401, 'credentials'],
    [403, 'blocked'],
    [410, 'expired'],
    [429, 'tooMany'],
    [0, 'unavailable'],
    [503, 'unavailable'],
  ])('maps %i to %s', (status, key) => {
    expect(authErrorFor(status)).toBe(key);
  });
});

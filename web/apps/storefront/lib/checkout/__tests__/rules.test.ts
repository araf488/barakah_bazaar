import { describe, expect, it } from 'vitest';

import { totalOf } from '../rules';

describe('totalOf', () => {
  it('adds the fee and takes off the discount', () => {
    expect(totalOf(250000, 6000, 10000)).toBe(246000);
  });

  it('never goes below zero', () => {
    expect(totalOf(1000, 0, 5000)).toBe(0);
  });
});

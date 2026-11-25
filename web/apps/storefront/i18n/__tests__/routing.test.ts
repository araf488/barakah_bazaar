import { describe, expect, it } from 'vitest';

import { routing } from '../routing';

describe('storefront routing', () => {
  it('serves Bangla and English, Bangla first', () => {
    expect(routing.locales).toEqual(['bn', 'en']);
    expect(routing.defaultLocale).toBe('bn');
  });

  it('prefixes every URL with its locale', () => {
    expect(routing.localePrefix).toBe('always');
  });

  it('does not let the browser language override the Bangla default', () => {
    expect(routing.localeDetection).toBe(false);
  });
});

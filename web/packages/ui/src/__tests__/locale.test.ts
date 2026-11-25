import { describe, expect, it } from 'vitest';
import { APP_LOCALES, DEFAULT_LOCALE, isAppLocale } from '../locale';

describe('app locales', () => {
  it('supports exactly Bangla and English, in that order', () => {
    expect(APP_LOCALES).toEqual(['bn', 'en']);
  });

  it('defaults to Bangla, because the storefront is Bangla-first', () => {
    expect(DEFAULT_LOCALE).toBe('bn');
  });

  it('recognises the two supported locales', () => {
    expect(isAppLocale('bn')).toBe(true);
    expect(isAppLocale('en')).toBe(true);
  });

  it('rejects anything else, including a plausible near-miss', () => {
    expect(isAppLocale('bn-BD')).toBe(false);
    expect(isAppLocale('EN')).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { loadMessages, resolveRequestLocale } from '../messages';

describe('resolveRequestLocale', () => {
  it.each(['bn', 'en'])('keeps the supported locale %s', (locale) => {
    expect(resolveRequestLocale(locale)).toBe(locale);
  });

  it('falls back to Bangla when no locale was requested', () => {
    expect(resolveRequestLocale(undefined)).toBe('bn');
  });

  it('falls back to Bangla for a locale the storefront does not serve', () => {
    expect(resolveRequestLocale('fr')).toBe('bn');
  });
});

describe('loadMessages', () => {
  it('loads the Bangla labels for bn', async () => {
    const messages = await loadMessages('bn');
    expect(messages.metadata.title).toBe('বারাকাহ বাজার — হালাল, খাঁটি, ঘরে পৌঁছে দেওয়া');
  });

  it('loads the English labels for en', async () => {
    const messages = await loadMessages('en');
    expect(messages.metadata.title).toBe('Barakah Bazaar — Halal. Wholesome. Home-delivered.');
  });
});

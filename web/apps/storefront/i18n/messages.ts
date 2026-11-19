import { hasLocale } from 'next-intl';

import { routing } from './routing';

export type StorefrontLocale = (typeof routing.locales)[number];

/**
 * The locale a request renders in. The proxy has already redirected every path into a known
 * locale, so the default is only reached by a request that skipped it (a bad segment, a test).
 */
export const resolveRequestLocale = (requested: string | undefined): StorefrontLocale =>
  hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

/** One JSON file per locale; product content never lives here, only UI labels. */
export const loadMessages = async (locale: StorefrontLocale) =>
  (await import(`../messages/${locale}.json`)).default as typeof import('../messages/en.json');

import { defineRouting } from 'next-intl/routing';
import { APP_LOCALES, DEFAULT_LOCALE } from '@barakah/ui';

/**
 * Every storefront URL carries its locale: `/bn/...` (the default) or `/en/...`. `always`
 * rather than `as-needed`, so a shared link never changes language for the person who opens
 * it, and the backend's unprefixed email links (`/verify-email?token=`) are redirected into
 * the visitor's locale with the query string intact.
 *
 * `localeDetection: false`: `/` always opens Bangla. Most phones in Bangladesh run with an
 * English system language, so honouring `Accept-Language` would make English the de facto
 * default for the audience the storefront is Bangla-first for. The header toggle switches.
 */
export const routing = defineRouting({
  locales: APP_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: false,
});

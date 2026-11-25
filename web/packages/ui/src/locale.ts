/** The storefront's two locales. Bangla leads: it is the default route prefix. */
export const APP_LOCALES = ['bn', 'en'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'bn';

/** Narrows an unknown value — a route param, a cookie — to a supported locale. */
export const isAppLocale = (value: unknown): value is AppLocale =>
  APP_LOCALES.some((locale) => locale === value);

/** The shop's clock: every date a shopper reads is Dhaka wall-clock time. */
export const DHAKA_TIME_ZONE = 'Asia/Dhaka';

/** The Intl locale each storefront locale formats dates with (Bengali digits on `bn`). */
const DATE_LOCALE: Record<string, string> = { bn: 'bn-BD', en: 'en-GB' };

export const dateLocaleOf = (locale: string): string => DATE_LOCALE[locale] ?? locale;

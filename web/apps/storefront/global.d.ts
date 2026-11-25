import type en from './messages/en.json';
import type { routing } from './i18n/routing';

/**
 * Types every `t('...')` key against `en.json`, so a label that does not exist is a compile
 * error rather than a raw key rendered to a customer (foundation spec §6.2, guardrail 1).
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof en;
  }
}

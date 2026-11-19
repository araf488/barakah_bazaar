'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Link, usePathname } from '../../i18n/navigation';
import type { StorefrontLocale } from '../../i18n/messages';

/** Each language named in itself, so a reader of either can find their own. */
export const LOCALE_NATIVE_NAME: Record<StorefrontLocale, string> = {
  bn: 'বাংলা',
  en: 'English',
};

const OTHER_LOCALE: Record<StorefrontLocale, StorefrontLocale> = { bn: 'en', en: 'bn' };

/** Swaps the locale prefix and keeps the visitor on the same page. */
export function LocaleSwitcher() {
  const t = useTranslations('header');
  const locale = useLocale();
  const pathname = usePathname();
  const target = OTHER_LOCALE[locale];

  return (
    <Link
      href={pathname}
      locale={target}
      hrefLang={target}
      aria-label={t('switchLocale')}
      className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-xs font-semibold text-subtle transition hover:border-brand hover:bg-warm hover:text-brand active:scale-95"
    >
      <span lang={target}>{LOCALE_NATIVE_NAME[target]}</span>
    </Link>
  );
}

import type { AppLocale } from './locale';

/** Any API entity carrying the bilingual name pair. */
export interface BilingualText {
  nameEn: string;
  nameBn: string;
}

export interface LocalizedPick {
  text: string;
  /** True when the requested language was empty and the other one was used. */
  isFallback: boolean;
}

const isBlank = (value: string | undefined): boolean => (value ?? '').trim().length === 0;

/**
 * Picks the name for `locale`, falling back to the other language when the
 * requested one is empty — and reporting that it did, so the caller can mark it.
 */
export const pickLocalized = (entity: BilingualText, locale: AppLocale): LocalizedPick => {
  const preferred = locale === 'bn' ? entity.nameBn : entity.nameEn;
  if (!isBlank(preferred)) {
    return { text: preferred, isFallback: false };
  }
  const other = locale === 'bn' ? entity.nameEn : entity.nameBn;
  return { text: other, isFallback: true };
};

export interface LocalizedNameProps {
  entity: BilingualText;
  locale: AppLocale;
}

/** The language actually rendered when the requested one turned out to be empty. */
const OTHER_LOCALE: Record<AppLocale, AppLocale> = { bn: 'en', en: 'bn' };

export const LocalizedName = ({ entity, locale }: LocalizedNameProps) => {
  const { text, isFallback } = pickLocalized(entity, locale);
  // One ternary, deliberately: a nested ternary trips Sonar S3358, whose only
  // exception is a provider-translated expression tree, which this is not.
  const renderedLang: AppLocale = isFallback ? OTHER_LOCALE[locale] : locale;

  return (
    <span lang={renderedLang} {...(isFallback ? { 'data-fallback-locale': locale } : {})}>
      {text}
    </span>
  );
};

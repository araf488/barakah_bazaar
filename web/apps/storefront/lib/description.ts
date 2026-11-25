import type { AppLocale } from '@barakah/ui';

import type { ProductDetail } from './api/catalog';

const isBlank = (value: string | null | undefined): boolean => (value ?? '').trim().length === 0;

/**
 * The description in the reader's language, falling back to the other one, split into
 * paragraphs on blank lines. `lang` is the language actually returned, for the `lang` attribute.
 */
export const pickDescription = (
  product: Pick<ProductDetail, 'descriptionEn' | 'descriptionBn'>,
  locale: AppLocale,
): { paragraphs: string[]; lang: AppLocale } | null => {
  const preferred = locale === 'bn' ? product.descriptionBn : product.descriptionEn;
  const other = locale === 'bn' ? product.descriptionEn : product.descriptionBn;
  const otherLocale: AppLocale = locale === 'bn' ? 'en' : 'bn';
  const [text, lang] = isBlank(preferred) ? [other, otherLocale] : [preferred, locale];
  if (isBlank(text)) {
    return null;
  }
  const paragraphs = (text ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  return { paragraphs, lang };
};

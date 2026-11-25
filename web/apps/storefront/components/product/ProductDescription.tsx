import { useLocale, useTranslations } from 'next-intl';

import type { ProductDetail } from '../../lib/api/catalog';
import { pickDescription } from '../../lib/description';

/**
 * The description in the reader's language (falling back to the other). The Figma's "Key
 * Highlights" tab is gone: the API has no highlights list to fill it.
 */
export function ProductDescription({
  product,
}: {
  product: Pick<ProductDetail, 'descriptionEn' | 'descriptionBn'>;
}) {
  const t = useTranslations('pdp');
  const locale = useLocale();
  const description = pickDescription(product, locale);

  return (
    <section aria-labelledby="about-title">
      <h2
        id="about-title"
        className="mb-3 border-b border-border pb-2 text-sm font-semibold text-ink"
      >
        {t('aboutTitle')}
      </h2>
      {description ? (
        <div lang={description.lang} className="space-y-3 text-sm leading-relaxed text-ink/80">
          {description.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-subtle">{t('noDescription')}</p>
      )}
    </section>
  );
}

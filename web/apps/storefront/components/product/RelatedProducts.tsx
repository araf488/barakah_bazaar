import { pickLocalized } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';

import { type CategoryNode, listNewestProducts, type ProductListItem } from '../../lib/api/catalog';
import { ProductCard } from './ProductCard';

/** How many other products the page suggests. */
export const RELATED_LIMIT = 4;

interface RelatedListProps {
  items: ProductListItem[];
  category: CategoryNode | undefined;
}

/** Up to four other products from the same category; nothing at all when there are none. */
export function RelatedList({ items, category }: RelatedListProps) {
  const t = useTranslations('pdp');
  const locale = useLocale();

  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="related-title" className="mt-16">
      <h2 id="related-title" className="mb-6 font-display text-2xl font-semibold text-ink">
        {category
          ? t('relatedTitle', { category: pickLocalized(category, locale).text })
          : t('relatedFallback')}
      </h2>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RelatedProductsProps {
  slug: string;
  categorySlug: string;
  category: CategoryNode | undefined;
}

/**
 * Loads the newest products in this product's category, minus this one. The API has no
 * "related" endpoint; same-category is the honest version of the Figma's "You might also like".
 * A failure leaves the section out rather than showing an error under a working product.
 */
export async function RelatedProducts({ slug, categorySlug, category }: RelatedProductsProps) {
  const result = await listNewestProducts({ categorySlug, limit: RELATED_LIMIT + 1 });
  const items = result.ok
    ? result.page.items.filter((item) => item.slug !== slug).slice(0, RELATED_LIMIT)
    : [];
  return <RelatedList items={items} category={category} />;
}

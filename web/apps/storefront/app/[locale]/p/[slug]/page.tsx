import { LocalizedName, pickLocalized } from '@barakah/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { Eyebrow } from '../../../../components/Eyebrow';
import { Breadcrumb } from '../../../../components/product/Breadcrumb';
import { BuyBox } from '../../../../components/product/BuyBox';
import { HandlingCard } from '../../../../components/product/HandlingCard';
import { ProductDescription } from '../../../../components/product/ProductDescription';
import { ProductGallery } from '../../../../components/product/ProductGallery';
import { RatingSummary } from '../../../../components/product/RatingSummary';
import { RelatedProducts } from '../../../../components/product/RelatedProducts';
import type { StorefrontLocale } from '../../../../i18n/messages';
import {
  fetchTopCategories,
  findCategoryBySlug,
  getProductBySlug,
} from '../../../../lib/api/catalog';
import { pickDescription } from '../../../../lib/description';

/** Prices and stock are live, so the page renders per request (its data is cached per minute). */
export const dynamic = 'force-dynamic';

/** Search results show this much of the description. */
const META_DESCRIPTION_LENGTH = 160;

interface ProductPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const result = await getProductBySlug(slug);
  if (!result.ok) {
    return {};
  }
  const appLocale = locale as StorefrontLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'pdp' });
  const description = pickDescription(result.product, appLocale)?.paragraphs[0];
  return {
    title: `${pickLocalized(result.product, appLocale).text} · ${t('titleSuffix')}`,
    ...(description ? { description: description.slice(0, META_DESCRIPTION_LENGTH) } : {}),
  };
}

/**
 * Product detail: breadcrumb, gallery, name and rating, size and price, how it travels, the
 * description, and more from the same category. An unknown or unpublished slug is a 404.
 */
export default async function ProductPage({ params }: ProductPageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale as StorefrontLocale);
  const [result, categories, t] = await Promise.all([
    getProductBySlug(slug),
    fetchTopCategories(),
    getTranslations('pdp'),
  ]);

  if (!result.ok && result.notFound) {
    notFound();
  }
  if (!result.ok) {
    return (
      <p
        role="alert"
        className="mx-auto max-w-7xl px-4 py-24 text-center text-sm text-subtle sm:px-6 lg:px-8"
      >
        {t('error')}
      </p>
    );
  }

  const { product } = result;
  const category = findCategoryBySlug(categories, product.categorySlug);
  const name = pickLocalized(product, locale as StorefrontLocale).text;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 pb-16 sm:px-6 lg:px-8">
      <Breadcrumb category={category} product={product} />
      <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2 xl:gap-16">
        <ProductGallery images={product.images} name={name} />
        <div className="space-y-6">
          <div>
            {category ? (
              <Eyebrow className="mb-2 text-subtle">
                <LocalizedName entity={category} locale={locale as StorefrontLocale} />
              </Eyebrow>
            ) : null}
            <h1 className="mb-3 font-display text-3xl leading-tight font-semibold text-ink sm:text-4xl">
              <LocalizedName entity={product} locale={locale as StorefrontLocale} />
            </h1>
            <RatingSummary rating={product.rating} />
          </div>
          <BuyBox slug={product.slug} variants={product.variants} />
          <HandlingCard handling={product.handling} />
          <ProductDescription product={product} />
        </div>
      </div>
      <Suspense fallback={null}>
        <RelatedProducts
          slug={product.slug}
          categorySlug={product.categorySlug}
          category={category}
        />
      </Suspense>
    </div>
  );
}

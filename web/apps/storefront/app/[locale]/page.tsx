import { setRequestLocale } from 'next-intl/server';

import { CategoryTiles } from '../../components/home/CategoryTiles';
import { DeliveryFacts } from '../../components/home/DeliveryFacts';
import { Hero } from '../../components/home/Hero';
import { NewArrivals } from '../../components/home/NewArrivals';
import { PromoPanels } from '../../components/home/PromoPanels';
import type { StorefrontLocale } from '../../i18n/messages';
import { fetchTopCategories } from '../../lib/api/catalog';
import { parseHomeFilter } from '../../lib/homeFilter';

/**
 * Rendered per request: the grid depends on the query string, and the category tree must come
 * from the running API, never from whatever answered (or failed to) during `next build`.
 */
export const dynamic = 'force-dynamic';

interface HomePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Hero, categories, new arrivals (filterable through the query string), how delivery and
 * payment work, and two editorial panels. The Figma's Flash Deals section is gone: the API has
 * no deals or sale windows to count down to.
 */
export default async function HomePage({ params, searchParams }: HomePageProps) {
  const [{ locale }, query, categories] = await Promise.all([
    params,
    searchParams,
    fetchTopCategories(),
  ]);
  setRequestLocale(locale as StorefrontLocale);
  const filter = parseHomeFilter(query);

  return (
    <>
      <Hero />
      <CategoryTiles categories={categories} />
      <NewArrivals filter={filter} categories={categories} />
      <DeliveryFacts />
      <PromoPanels />
    </>
  );
}

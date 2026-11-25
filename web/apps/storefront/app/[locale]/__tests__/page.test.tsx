import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { category } from '../../../test/fixtures';

vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }));
vi.mock('../../../lib/api/catalog', () => ({ fetchTopCategories: vi.fn() }));

const { default: HomePage } = await import('../page');
const { setRequestLocale } = await import('next-intl/server');
const { fetchTopCategories } = await import('../../../lib/api/catalog');
const { Hero } = await import('../../../components/home/Hero');
const { CategoryTiles } = await import('../../../components/home/CategoryTiles');
const { NewArrivals } = await import('../../../components/home/NewArrivals');
const { DeliveryFacts } = await import('../../../components/home/DeliveryFacts');
const { PromoPanels } = await import('../../../components/home/PromoPanels');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;

const CATEGORIES = [category()];

const render = async (query: Record<string, string>) =>
  (await HomePage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve(query),
  })) as AnyElement;

const sections = (fragment: AnyElement): AnyElement[] =>
  ([] as ReactNode[]).concat(fragment.props.children).filter(isValidElement) as AnyElement[];

describe('home page', () => {
  beforeEach(() => {
    vi.mocked(fetchTopCategories).mockClear().mockResolvedValue(CATEGORIES);
    vi.mocked(setRequestLocale).mockClear();
  });

  it('lays out hero, categories, new arrivals, delivery facts and promotions, in that order', async () => {
    expect(sections(await render({})).map((el) => el.type)).toEqual([
      Hero,
      CategoryTiles,
      NewArrivals,
      DeliveryFacts,
      PromoPanels,
    ]);
  });

  it('feeds the loaded categories to both the tiles and the filter chips', async () => {
    const [, tiles, arrivals] = sections(await render({}));
    expect(tiles?.props.categories).toBe(CATEGORIES);
    expect(arrivals?.props.categories).toBe(CATEGORIES);
  });

  it('applies the filter named in the query string', async () => {
    const [, , arrivals] = sections(await render({ category: 'dates' }));
    expect(arrivals?.props.filter).toEqual({ kind: 'category', slug: 'dates' });
  });

  it('renders in the route locale', async () => {
    await render({});
    expect(setRequestLocale).toHaveBeenCalledWith('en');
  });
});

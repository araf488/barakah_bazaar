import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { category } from '../../../../../test/fixtures';
import { productDetail } from '../../../../../test/productDetail';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => `t:${key}`),
}));
vi.mock('../../../../../lib/api/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/api/catalog')>()),
  getProductBySlug: vi.fn(),
  fetchTopCategories: vi.fn(),
}));

const { default: ProductPage, generateMetadata } = await import('../page');
const { getProductBySlug, fetchTopCategories } = await import('../../../../../lib/api/catalog');
const { Breadcrumb } = await import('../../../../../components/product/Breadcrumb');
const { ProductGallery } = await import('../../../../../components/product/ProductGallery');
const { BuyBox } = await import('../../../../../components/product/BuyBox');
const { HandlingCard } = await import('../../../../../components/product/HandlingCard');
const { RelatedProducts } = await import('../../../../../components/product/RelatedProducts');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;

const elementsOf = (node: ReactNode): AnyElement[] => {
  if (Array.isArray(node)) {
    return node.flatMap(elementsOf);
  }
  if (!isValidElement(node)) {
    return [];
  }
  const element = node as AnyElement;
  return [element, ...elementsOf(element.props.children)];
};

const params = (locale = 'en', slug = 'ajwa-dates') => ({
  params: Promise.resolve({ locale, slug }),
});
const PRODUCT = productDetail();
const TREE = [category()];

describe('product page', () => {
  beforeEach(() => {
    vi.mocked(getProductBySlug).mockReset().mockResolvedValue({ ok: true, product: PRODUCT });
    vi.mocked(fetchTopCategories).mockReset().mockResolvedValue(TREE);
  });

  it('assembles breadcrumb, gallery, buy box, handling and related products', async () => {
    const tree = elementsOf(await ProductPage(params()));
    const of = (type: unknown) => tree.find((el) => el.type === type);

    expect(of(Breadcrumb)?.props.category).toBe(TREE[0]);
    expect(of(ProductGallery)?.props).toMatchObject({ images: PRODUCT.images, name: 'Ajwa Dates' });
    expect(of(BuyBox)?.props.variants).toBe(PRODUCT.variants);
    expect(of(HandlingCard)?.props.handling).toBe(PRODUCT.handling);
    expect(of(RelatedProducts)?.props).toMatchObject({ slug: 'ajwa-dates', categorySlug: 'dates' });
  });

  it('names the gallery in the reader’s language', async () => {
    const tree = elementsOf(await ProductPage(params('bn')));
    expect(tree.find((el) => el.type === ProductGallery)?.props.name).toBe('আজওয়া খেজুর');
  });

  it('answers 404 for an unknown or unpublished product', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({ ok: false, notFound: true });
    await expect(ProductPage(params())).rejects.toBe(NOT_FOUND);
  });

  it('shows its error state, not a 404, when the API fails', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({ ok: false, notFound: false });

    const page = (await ProductPage(params())) as AnyElement;

    expect(page.props.role).toBe('alert');
    expect(page.props.children).toBe('t:error');
  });

  it('titles the page with the product name and the shop', async () => {
    await expect(generateMetadata(params())).resolves.toEqual({
      title: 'Ajwa Dates · t:titleSuffix',
      description: 'Soft Ajwa dates from Madinah.',
    });
  });

  it('adds no metadata when the product cannot be loaded', async () => {
    vi.mocked(getProductBySlug).mockResolvedValue({ ok: false, notFound: true });
    await expect(generateMetadata(params())).resolves.toEqual({});
  });
});

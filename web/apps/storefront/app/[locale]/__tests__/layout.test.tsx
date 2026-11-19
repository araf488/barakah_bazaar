import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { category } from '../../../test/fixtures';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async ({ locale }: { locale: string }) =>
      (key: string) =>
        `${locale}:${key}`,
  ),
  setRequestLocale: vi.fn(),
}));

vi.mock('../../fonts', () => ({ fontVariables: 'face-display face-body face-bengali' }));

vi.mock('../../../lib/api/catalog', () => ({ fetchTopCategories: vi.fn() }));
vi.mock('../../../lib/auth/session', () => ({ getCurrentUser: vi.fn() }));

const { default: LocaleLayout, generateMetadata, generateStaticParams } = await import('../layout');
const { setRequestLocale } = await import('next-intl/server');
const { fetchTopCategories } = await import('../../../lib/api/catalog');
const { getCurrentUser } = await import('../../../lib/auth/session');
const { SiteHeader } = await import('../../../components/shell/SiteHeader');
const { SiteFooter } = await import('../../../components/shell/SiteFooter');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;

const paramsFor = (locale: string) => ({ params: Promise.resolve({ locale }) });

/** Every element in a rendered tree, depth first, without mounting it. */
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

const CATEGORIES = [category()];
const USER = {
  id: 'u1',
  email: 'tahmina@example.test',
  fullName: 'Tahmina Rahman',
  phoneVerified: false,
  role: 'CUSTOMER',
  createdAt: '2026-11-01T00:00:00Z',
};

describe('locale layout', () => {
  beforeEach(() => {
    vi.mocked(setRequestLocale).mockClear();
    vi.mocked(fetchTopCategories).mockClear().mockResolvedValue(CATEGORIES);
    vi.mocked(getCurrentUser).mockClear().mockResolvedValue(USER);
  });

  it('pre-renders exactly the two storefront locales', () => {
    expect(generateStaticParams()).toEqual([{ locale: 'bn' }, { locale: 'en' }]);
  });

  it('sets the document language to the route locale and applies the font faces', async () => {
    const html = (await LocaleLayout({ children: null, ...paramsFor('bn') })) as AnyElement;

    expect(html.type).toBe('html');
    expect(html.props.lang).toBe('bn');
    expect(html.props.className).toBe('face-display face-body face-bengali');
    expect(setRequestLocale).toHaveBeenCalledWith('bn');
  });

  it('wraps the page in the shell: skip link, header, main landmark, footer', async () => {
    const page = <p>page body</p>;
    const tree = elementsOf(await LocaleLayout({ children: page, ...paramsFor('en') }));

    const skip = tree.find((el) => el.type === 'a');
    const main = tree.find((el) => el.type === 'main');
    expect(skip?.props.href).toBe('#main');
    expect(skip?.props.children).toBe('en:skipToContent');
    expect(main?.props.id).toBe('main');
    expect(main?.props.children).toBe(page);
    expect(tree.find((el) => el.type === SiteHeader)?.props).toMatchObject({
      categories: CATEGORIES,
      user: USER,
    });
    expect(tree.find((el) => el.type === SiteFooter)?.props.categories).toBe(CATEGORIES);
  });

  it('answers 404 for a locale the storefront does not serve, before loading anything', async () => {
    await expect(LocaleLayout({ children: null, ...paramsFor('fr') })).rejects.toBe(NOT_FOUND);
    expect(setRequestLocale).not.toHaveBeenCalled();
    expect(fetchTopCategories).not.toHaveBeenCalled();
  });

  it('titles the page in the route locale', async () => {
    await expect(generateMetadata(paramsFor('en'))).resolves.toEqual({
      title: 'en:title',
      description: 'en:description',
    });
  });

  it('answers 404 before translating metadata for an unknown locale', async () => {
    await expect(generateMetadata(paramsFor('fr'))).rejects.toBe(NOT_FOUND);
  });
});

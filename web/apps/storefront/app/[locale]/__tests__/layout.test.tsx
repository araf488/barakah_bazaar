import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');

vi.mock('next/navigation', () => ({
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

const { default: LocaleLayout, generateMetadata, generateStaticParams } = await import('../layout');
const { setRequestLocale } = await import('next-intl/server');

const paramsFor = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe('locale layout', () => {
  beforeEach(() => vi.mocked(setRequestLocale).mockClear());

  it('pre-renders exactly the two storefront locales', () => {
    expect(generateStaticParams()).toEqual([{ locale: 'bn' }, { locale: 'en' }]);
  });

  it('sets the document language to the route locale and applies the font faces', async () => {
    const html = (await LocaleLayout({ children: null, ...paramsFor('bn') })) as ReactElement<{
      lang: string;
      className: string;
    }>;

    expect(html.type).toBe('html');
    expect(html.props.lang).toBe('bn');
    expect(html.props.className).toBe('face-display face-body face-bengali');
    expect(setRequestLocale).toHaveBeenCalledWith('bn');
  });

  it('answers 404 for a locale the storefront does not serve', async () => {
    await expect(LocaleLayout({ children: null, ...paramsFor('fr') })).rejects.toBe(NOT_FOUND);
    expect(setRequestLocale).not.toHaveBeenCalled();
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

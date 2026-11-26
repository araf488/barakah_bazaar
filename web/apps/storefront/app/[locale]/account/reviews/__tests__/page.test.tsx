import { isValidElement, type ReactElement, type ReactNode, Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';

const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => `t:${key}`),
}));
vi.mock('../../../../../i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../i18n/navigation')>()),
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../../../../lib/auth/session', () => ({ getCurrentUser: vi.fn() }));
vi.mock('../../../../../lib/reviews/api', () => ({ getMyReviews: vi.fn() }));
vi.mock('../../../../../lib/reviews/actions', () => ({ submitReviewAction: vi.fn() }));

const { default: MyReviewsPage, generateMetadata } = await import('../page');
const { getCurrentUser } = await import('../../../../../lib/auth/session');
const { redirect } = await import('../../../../../i18n/navigation');
const { MyReviews, MyReviewsSkeleton } =
  await import('../../../../../components/reviews/MyReviews');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
const elementsOf = (node: ReactNode): AnyElement[] => {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  return [element, ...elementsOf(element.props.children)];
};
const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({ locale: 'en' }),
  searchParams: Promise.resolve(query),
});
const USER = {
  id: 'u1',
  email: 'tahmina@example.test',
  fullName: 'Tahmina Rahman',
  phoneVerified: false,
  role: 'CUSTOMER',
  createdAt: '2026-11-01',
};

describe('my reviews page', () => {
  it('sends a visitor who is not signed in to sign in, and back here after', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    await expect(MyReviewsPage(props())).rejects.toBe(REDIRECTED);

    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/account/reviews' } },
      locale: 'en',
    });
  });

  it('loads the lists behind a placeholder, under a heading and a way back', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);

    const tree = elementsOf(await MyReviewsPage(props()));

    expect(tree.find((el) => el.type === 'h1')?.props.children).toBe('t:title');
    expect(tree.some((el) => el.props.href === '/account')).toBe(true);
    const suspense = tree.find((el) => el.type === Suspense);
    expect(elementsOf(suspense?.props.children).some((el) => el.type === MyReviews)).toBe(true);
    const fallback = suspense?.props.fallback as AnyElement;
    expect(fallback.type).toBe(MyReviewsSkeleton);
    expect(fallback.props.label).toBe('t:loading');
  });

  it('thanks the customer after a review is sent, and only then', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);

    const thanked = elementsOf(await MyReviewsPage(props({ sent: '1' })));
    const status = thanked.find((el) => el.props.role === 'status');
    expect(status?.props.children).toBe('t:sent');

    const plain = elementsOf(await MyReviewsPage(props()));
    expect(plain.some((el) => el.props.role === 'status')).toBe(false);
  });

  it('keeps the page out of search results', async () => {
    await expect(generateMetadata(props())).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
  });
});

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
vi.mock('../../../../../lib/account/security', () => ({ getDeviceSessions: vi.fn() }));
vi.mock('../../../../../lib/account/securityActions', () => ({}));
vi.mock('../../../../../lib/auth/actions', () => ({ signOutAction: vi.fn() }));

const { default: SecurityPage, generateMetadata } = await import('../page');
const { getCurrentUser } = await import('../../../../../lib/auth/session');
const { redirect } = await import('../../../../../i18n/navigation');
const { ChangePasswordForm } = await import('../../../../../components/account/ChangePasswordForm');
const { DeviceList, DeviceListSkeleton } =
  await import('../../../../../components/account/DeviceList');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
const elementsOf = (node: ReactNode): AnyElement[] => {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  return [element, ...elementsOf(element.props.children)];
};
const params = { params: Promise.resolve({ locale: 'en' }) };
const USER = {
  id: 'u1',
  email: 'tahmina@example.test',
  fullName: 'Tahmina Rahman',
  phoneVerified: false,
  role: 'CUSTOMER',
  createdAt: '2026-11-01',
};

describe('security page', () => {
  it('sends a visitor who is not signed in to sign in, and back here after', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    await expect(SecurityPage(params)).rejects.toBe(REDIRECTED);

    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/account/security' } },
      locale: 'en',
    });
  });

  it('shows the password form and the device list, loading behind a placeholder', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);

    const tree = elementsOf(await SecurityPage(params));

    expect(tree.some((el) => el.type === ChangePasswordForm)).toBe(true);
    const suspense = tree.find((el) => el.type === Suspense);
    expect(elementsOf(suspense?.props.children).some((el) => el.type === DeviceList)).toBe(true);
    const fallback = suspense?.props.fallback as AnyElement;
    expect(fallback.type).toBe(DeviceListSkeleton);
    expect(fallback.props.label).toBe('t:devices.loading');
  });

  it('leads back to the account page', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);

    const tree = elementsOf(await SecurityPage(params));

    expect(tree.some((el) => el.props.href === '/account')).toBe(true);
    expect(tree.find((el) => el.type === 'h1')?.props.children).toBe('t:title');
  });

  it('keeps the page out of search results', async () => {
    await expect(generateMetadata(params)).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
  });
});

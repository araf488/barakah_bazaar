import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { address } from '../../../../test/address';

const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => `t:${key}`),
}));
vi.mock('../../../../i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../i18n/navigation')>()),
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../../../lib/auth/session', () => ({ getCurrentUser: vi.fn() }));
vi.mock('../../../../lib/account/addresses', () => ({ getAddressBook: vi.fn() }));
vi.mock('../../../../lib/auth/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('../../../../lib/account/actions', () => ({}));

const { default: AccountPage } = await import('../page');
const { getCurrentUser } = await import('../../../../lib/auth/session');
const { getAddressBook } = await import('../../../../lib/account/addresses');
const { redirect } = await import('../../../../i18n/navigation');
const { AddressBook } = await import('../../../../components/account/AddressBook');

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

describe('account page', () => {
  it('sends a visitor who is not signed in to sign in, and back here after', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(AccountPage(params)).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/account' } },
      locale: 'en',
    });
  });

  it('shows the profile and the address book', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [address()] });

    const tree = elementsOf(await AccountPage(params));

    expect(tree.find((el) => el.type === AddressBook)?.props.addresses).toEqual([address()]);
    expect(tree.some((el) => el.props.children === 'Tahmina Rahman')).toBe(true);
  });

  it('says so when the addresses could not be loaded', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(getAddressBook).mockResolvedValue({ ok: false });

    const tree = elementsOf(await AccountPage(params));

    expect(tree.find((el) => el.props.role === 'alert')?.props.children).toBe(
      't:address.loadError',
    );
    expect(tree.find((el) => el.type === AddressBook)).toBeUndefined();
  });
  it('leads to the orders', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [] });

    const tree = elementsOf(await AccountPage(params));

    const link = tree.find((el) => el.props.href === '/account/orders');
    expect(link?.props.children).toBe('t:account.ordersLink');
  });

  it('leads to sign-in and security', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [] });

    const tree = elementsOf(await AccountPage(params));

    const link = tree.find((el) => el.props.href === '/account/security');
    expect(link?.props.children).toBe('t:account.securityLink');
  });

  it('leads to the customer’s reviews', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(getAddressBook).mockResolvedValue({ ok: true, addresses: [] });

    const tree = elementsOf(await AccountPage(params));

    const link = tree.find((el) => el.props.href === '/account/reviews');
    expect(link?.props.children).toBe('t:account.reviewsLink');
  });
});

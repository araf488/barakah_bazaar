import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../../../../test/checkout';

const REDIRECTED = new Error('NEXT_REDIRECT');
const NOT_FOUND = new Error('NEXT_NOT_FOUND');

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(
    async () => (key: string, values?: Record<string, string>) =>
      values ? `t:${key}:${JSON.stringify(values)}` : `t:${key}`,
  ),
}));
vi.mock('../../../../../../i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../i18n/navigation')>()),
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../../../../../lib/auth/session', () => ({ getCurrentUser: vi.fn() }));
vi.mock('../../../../../../lib/checkout/getOrder', () => ({ getOrder: vi.fn() }));

const { default: OrderPlacedPage } = await import('../page');
const { getCurrentUser } = await import('../../../../../../lib/auth/session');
const { getOrder } = await import('../../../../../../lib/checkout/getOrder');
const { redirect } = await import('../../../../../../i18n/navigation');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
const elementsOf = (node: ReactNode): AnyElement[] => {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  return [element, ...elementsOf(element.props.children)];
};
const textOf = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement(node) ? textOf((node as AnyElement).props.children) : '';
};
const params = (locale = 'en') => ({ params: Promise.resolve({ locale, id: 'order-1' }) });
const USER = { id: 'u1', email: 'a@b.co', phoneVerified: false, role: 'CUSTOMER', createdAt: '' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(USER);
  vi.mocked(getOrder).mockResolvedValue(order());
});

describe('order placed page', () => {
  it('sends a visitor who is not signed in to sign in, and back to this order', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(OrderPlacedPage(params())).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/checkout/placed/order-1' } },
      locale: 'en',
    });
  });

  it('is a 404 for an order that is not theirs', async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    await expect(OrderPlacedPage(params())).rejects.toBe(NOT_FOUND);
  });

  it('shows the order number, what to pay on delivery, the address and the lines', async () => {
    const text = textOf(await OrderPlacedPage(params()));

    expect(text).toContain('BB-20261119-0001');
    expect(text).toContain('t:placed.payOnDelivery:{"total":"৳2,560.00"}');
    expect(text).toContain('House 12, Road 4, Banani, Gulshan, Dhaka 1213');
    expect(text).toContain('Ajwa Dates');
    expect(text).toContain('৳60.00');
  });

  it('shows a discount and the note only when the order has them', async () => {
    let text = textOf(await OrderPlacedPage(params()));
    expect(text).not.toContain('t:discountTotal');
    expect(text).not.toContain('t:placed.note');

    vi.mocked(getOrder).mockResolvedValue(
      order({ discountPoysha: 25000, customerNote: 'Ring twice', deliveryFeePoysha: 0 }),
    );
    text = textOf(await OrderPlacedPage(params()));
    expect(text).toContain('t:discountTotal');
    expect(text).toContain('−৳250.00');
    expect(text).toContain('Ring twice');
    expect(text).toContain('t:deliveryFree');
  });

  it('names the products and writes amounts in Bangla on a Bangla page', async () => {
    const tree = elementsOf(await OrderPlacedPage(params('bn')));
    const text = textOf(tree[0]);
    expect(text).toContain('আজওয়া খেজুর');
    expect(text).toContain('৳২,৫৬০.০০');
  });
});

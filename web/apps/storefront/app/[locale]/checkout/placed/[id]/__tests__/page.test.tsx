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
const { OrderItems, OrderTotals } =
  await import('../../../../../../components/orders/OrderContents');
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

  it('shows the order number, what to pay on delivery and the address', async () => {
    const text = textOf(await OrderPlacedPage(params()));

    expect(text).toContain('BB-20261119-0001');
    expect(text).toContain('t:placed.payOnDelivery:{"total":"৳2,560.00"}');
    expect(text).toContain('House 12, Road 4, Banani, Gulshan, Dhaka 1213');
  });

  it('lists what was ordered and the amounts charged', async () => {
    const placed = order();
    vi.mocked(getOrder).mockResolvedValue(placed);
    const tree = elementsOf(await OrderPlacedPage(params()));

    expect(tree.find((element) => element.type === OrderItems)?.props.items).toBe(placed.items);
    expect(tree.find((element) => element.type === OrderTotals)?.props.order).toBe(placed);
  });

  it('shows the note only when the order has one', async () => {
    expect(textOf(await OrderPlacedPage(params()))).not.toContain('t:placed.note');

    vi.mocked(getOrder).mockResolvedValue(order({ customerNote: 'Ring twice' }));
    const text = textOf(await OrderPlacedPage(params()));
    expect(text).toContain('t:placed.note');
    expect(text).toContain('Ring twice');
  });

  it('offers to keep shopping or to follow the order', async () => {
    const hrefs = elementsOf(await OrderPlacedPage(params()))
      .map((element) => element.props.href)
      .filter(Boolean);
    expect(hrefs).toContain('/account/orders/order-1');
  });
});

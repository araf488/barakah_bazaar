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
vi.mock('../../../../../../lib/orders/actions', () => ({}));
vi.mock('../../../../../../lib/payments/actions', () => ({}));

const { default: OrderPage } = await import('../page');
const { getCurrentUser } = await import('../../../../../../lib/auth/session');
const { getOrder } = await import('../../../../../../lib/checkout/getOrder');
const { redirect } = await import('../../../../../../i18n/navigation');
const { CancelOrder } = await import('../../../../../../components/orders/CancelOrder');
const { BkashPayPanel } = await import('../../../../../../components/payments/BkashPayPanel');
const { OrderTimeline } = await import('../../../../../../components/orders/OrderTimeline');
const { OrderItems, OrderTotals } =
  await import('../../../../../../components/orders/OrderContents');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;

const SERVER_PARTS = new Set(['DeliveryCard', 'PaymentCard']);
const elementsOf = async (node: ReactNode): Promise<AnyElement[]> => {
  if (Array.isArray(node)) return (await Promise.all(node.map(elementsOf))).flat();
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  const type = element.type as { name?: string } & ((props: unknown) => Promise<ReactNode>);
  if (typeof type === 'function' && SERVER_PARTS.has(type.name ?? '')) {
    return [element, ...(await elementsOf(await type(element.props)))];
  }
  return [element, ...(await elementsOf(element.props.children))];
};
const textOf = (tree: AnyElement[]): string =>
  tree
    .flatMap((element) => [element.props.children].flat())
    .filter((child) => typeof child === 'string')
    .join('|');
const render = async (locale = 'en') =>
  elementsOf(await OrderPage({ params: Promise.resolve({ locale, id: 'order-1' }) }));
const USER = { id: 'u1', email: 'a@b.co', phoneVerified: false, role: 'CUSTOMER', createdAt: '' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(USER);
  vi.mocked(getOrder).mockResolvedValue(order());
});

describe('order page', () => {
  it('sends a visitor who is not signed in to sign in, and back to this order', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render()).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/account/orders/order-1' } },
      locale: 'en',
    });
  });

  it('is a 404 for an order that is not theirs or is gone', async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    await expect(render()).rejects.toBe(NOT_FOUND);
    expect(getOrder).toHaveBeenCalledWith('order-1');
  });

  it('shows the order, its history, contents, address and payment', async () => {
    const shown = order({ customerNote: 'Ring twice' });
    vi.mocked(getOrder).mockResolvedValue(shown);
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain('BB-20261119-0001');
    expect(text).toContain('t:placedOn:{"date":"19 Nov 2026"}');
    expect(tree.find((el) => el.type === OrderTimeline)?.props.order).toBe(shown);
    expect(tree.find((el) => el.type === OrderItems)?.props.items).toBe(shown.items);
    expect(tree.find((el) => el.type === OrderTotals)?.props.order).toBe(shown);
    expect(text).toContain('House 12, Road 4, Banani, Gulshan, Dhaka 1213');
    expect(text).toContain('Ring twice');
    expect(text).toContain('t:paymentMethod.CASH_ON_DELIVERY');
    expect(text).toContain('t:paymentStatus.PENDING');
    expect(tree.some((el) => el.props.href === '/account/orders')).toBe(true);
  });

  it('hands the cancel control what the API says about cancelling', async () => {
    vi.mocked(getOrder).mockResolvedValue(order({ status: 'PICKING', canCancel: false }));
    const cancel = (await render()).find((el) => el.type === CancelOrder);
    expect(cancel?.props).toEqual({
      orderId: 'order-1',
      orderNumber: 'BB-20261119-0001',
      canCancel: false,
    });
  });

  it('leaves the note out when there is none', async () => {
    expect(textOf(await render())).not.toContain('t:note');
  });

  it('offers to pay a bKash order that still waits for its money', async () => {
    vi.mocked(getOrder).mockResolvedValue(order({ paymentMethod: 'BKASH' }));
    const panel = (await render()).find((el) => el.type === BkashPayPanel);
    expect(panel?.props).toEqual({ orderId: 'order-1', totalPoysha: 256000, awaiting: true });
  });

  it('offers no bKash payment for a cash order or a paid one', async () => {
    let panel = (await render()).find((el) => el.type === BkashPayPanel);
    expect(panel?.props.awaiting).toBe(false);

    vi.mocked(getOrder).mockResolvedValue(
      order({ paymentMethod: 'BKASH', paymentStatus: 'PAID', status: 'CONFIRMED' }),
    );
    panel = (await render()).find((el) => el.type === BkashPayPanel);
    expect(panel?.props.awaiting).toBe(false);
  });

  it('leads a delivered order to reviewing its products', async () => {
    vi.mocked(getOrder).mockResolvedValue(order({ status: 'DELIVERED' }));

    const link = (await render()).find((el) => el.props.href === '/account/reviews');

    expect(link?.props.children).toBe('t:detail.reviewItems');
  });

  it('offers no review before the order is delivered', async () => {
    vi.mocked(getOrder).mockResolvedValue(order({ status: 'DISPATCHED' }));

    expect((await render()).some((el) => el.props.href === '/account/reviews')).toBe(false);
  });
});

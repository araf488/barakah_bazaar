import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../../../test/checkout';
import { page } from '../../../../../test/fixtures';

const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(
    async () => (key: string, values?: Record<string, string>) =>
      values ? `t:${key}:${JSON.stringify(values)}` : `t:${key}`,
  ),
}));
vi.mock('../../../../../i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../i18n/navigation')>()),
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../../../../lib/auth/session', () => ({ getCurrentUser: vi.fn() }));
vi.mock('../../../../../lib/orders/getOrders', () => ({ getOrders: vi.fn() }));

const { default: OrdersPage } = await import('../page');
const { getCurrentUser } = await import('../../../../../lib/auth/session');
const { getOrders } = await import('../../../../../lib/orders/getOrders');
const { redirect } = await import('../../../../../i18n/navigation');
const { OrderCard } = await import('../../../../../components/orders/OrderCard');
const { OrderFilters } = await import('../../../../../components/orders/OrderFilters');
const { OrderListSkeleton } = await import('../../../../../components/orders/OrderListSkeleton');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;

/** The page's own async server pieces, rendered so the test sees what they return. */
const SERVER_PARTS = new Set(['OrderList', 'Pagination', 'EmptyOrders', 'OrdersUnavailable']);
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
    .map((element) => element.props.children)
    .filter((child) => typeof child === 'string')
    .join('|');
const hrefsOf = (tree: AnyElement[]) =>
  tree.map((element) => element.props.href).filter((href) => href !== undefined);

const render = async (search: Record<string, string> = {}) =>
  elementsOf(
    await OrdersPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(search),
    }),
  );
const USER = { id: 'u1', email: 'a@b.co', phoneVerified: false, role: 'CUSTOMER', createdAt: '' };
const meta = (overrides: Partial<ReturnType<typeof page>['meta']> = {}) => ({
  ...page([]).meta,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(USER);
  vi.mocked(getOrders).mockResolvedValue({ ok: true, page: page([order()]) });
});

describe('orders page', () => {
  it('sends a visitor who is not signed in to sign in, and back here after', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render()).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/account/orders' } },
      locale: 'en',
    });
    expect(getOrders).not.toHaveBeenCalled();
  });

  it('lists the orders under the filters, with a skeleton while they load', async () => {
    const tree = await render();

    expect(tree.find((el) => el.type === OrderFilters)?.props.active).toBe('all');
    expect(tree.some((el) => el.props.fallback && isValidElement(el.props.fallback))).toBe(true);
    expect(tree.find((el) => isValidElement(el.props.fallback))?.props.fallback).toMatchObject({
      type: OrderListSkeleton,
    });
    expect(tree.filter((el) => el.type === OrderCard).map((el) => el.props.order)).toEqual([
      order(),
    ]);
    expect(getOrders).toHaveBeenCalledWith({ filter: 'all', page: 1 });
  });

  it('reads the filter and page from the address', async () => {
    const tree = await render({ status: 'DELIVERED', page: '2' });
    expect(getOrders).toHaveBeenCalledWith({ filter: 'DELIVERED', page: 2 });
    expect(tree.find((el) => el.type === OrderFilters)?.props.active).toBe('DELIVERED');
  });

  it('pages newer and older within the same filter', async () => {
    vi.mocked(getOrders).mockResolvedValue({
      ok: true,
      page: { items: [order()], meta: meta({ page: 2, totalPages: 3, hasNextPage: true }) },
    });
    const tree = await render({ status: 'DELIVERED', page: '2' });

    expect(hrefsOf(tree)).toEqual(
      expect.arrayContaining([
        { pathname: '/account/orders', query: { status: 'DELIVERED' } },
        { pathname: '/account/orders', query: { status: 'DELIVERED', page: '3' } },
      ]),
    );
    expect(textOf(tree)).toContain('t:pageOf:{"page":"2","total":"3"}');
  });

  it('shows no paging when every order fits on one page', async () => {
    const tree = await render();
    expect(tree.find((el) => el.props['aria-label'] === 't:pagesLabel')).toBeUndefined();
  });

  it('invites a first order when there are none', async () => {
    vi.mocked(getOrders).mockResolvedValue({ ok: true, page: page([]) });
    const tree = await render();
    expect(textOf(tree)).toContain('t:empty');
    expect(textOf(tree)).toContain('t:startShopping');
  });

  it('offers the whole list when a filter has nothing in it', async () => {
    vi.mocked(getOrders).mockResolvedValue({ ok: true, page: page([]) });
    const tree = await render({ status: 'CANCELLED' });
    expect(textOf(tree)).toContain('t:emptyFiltered');
    expect(hrefsOf(tree)).toContainEqual({ pathname: '/account/orders', query: {} });
  });

  it('says so and offers to try again when the orders could not be loaded', async () => {
    vi.mocked(getOrders).mockResolvedValue({ ok: false });
    const tree = await render({ status: 'DISPATCHED' });

    expect(tree.find((el) => el.props.role === 'alert')).toBeDefined();
    expect(textOf(tree)).toContain('t:loadError');
    expect(hrefsOf(tree)).toContainEqual({
      pathname: '/account/orders',
      query: { status: 'DISPATCHED' },
    });
  });
});

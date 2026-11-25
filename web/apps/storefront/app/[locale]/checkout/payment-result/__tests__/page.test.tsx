import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { order } from '../../../../../test/checkout';

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
vi.mock('../../../../../lib/payments/findOrder', () => ({ findOrderByNumber: vi.fn() }));
vi.mock('../../../../../lib/payments/actions', () => ({}));

const { default: PaymentResultPage } = await import('../page');
const { getCurrentUser } = await import('../../../../../lib/auth/session');
const { findOrderByNumber } = await import('../../../../../lib/payments/findOrder');
const { redirect } = await import('../../../../../i18n/navigation');
const { BkashPayPanel } = await import('../../../../../components/payments/BkashPayPanel');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
const elementsOf = (node: ReactNode): AnyElement[] => {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as AnyElement;
  return [element, ...elementsOf(element.props.children)];
};
const textOf = (tree: AnyElement[]): string =>
  tree
    .flatMap((element) => [element.props.children].flat())
    .filter((child) => typeof child === 'string')
    .join('|');
const render = async (search: Record<string, string>) =>
  elementsOf(
    await PaymentResultPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(search),
    }),
  );
const USER = { id: 'u1', email: 'a@b.co', phoneVerified: false, role: 'CUSTOMER', createdAt: '' };
const WAITING = order({ id: 'order-7', orderNumber: 'BB-7', paymentMethod: 'BKASH' });
const panelOf = (tree: AnyElement[]) => tree.find((el) => el.type === BkashPayPanel)?.props;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(USER);
  vi.mocked(findOrderByNumber).mockResolvedValue(WAITING);
});

describe('payment result page', () => {
  it('sends a visitor who is not signed in to sign in, and back to this result', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render({ order: 'BB-7', outcome: 'paid' })).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith({
      href: {
        pathname: '/sign-in',
        query: { next: '/checkout/payment-result?order=BB-7&outcome=paid' },
      },
      locale: 'en',
    });
  });

  it('says the payment arrived and links to the order', async () => {
    vi.mocked(findOrderByNumber).mockResolvedValue(
      order({ ...WAITING, paymentStatus: 'PAID', status: 'CONFIRMED' }),
    );
    const tree = await render({ order: 'BB-7', outcome: 'paid' });

    expect(findOrderByNumber).toHaveBeenCalledWith('BB-7');
    expect(textOf(tree)).toContain('t:paid.heading');
    expect(textOf(tree)).toContain('BB-7');
    expect(tree.some((el) => el.props.href === '/account/orders/order-7')).toBe(true);
    expect(panelOf(tree)?.awaiting).toBe(false);
  });

  it('offers another try or cash after a failed or cancelled attempt', async () => {
    for (const outcome of ['failed', 'cancelled']) {
      const tree = await render({ order: 'BB-7', outcome });
      expect(textOf(tree)).toContain(`t:${outcome}.body`);
      expect(panelOf(tree)).toEqual({ orderId: 'order-7', totalPoysha: 256000, awaiting: true });
    }
  });

  it('never offers another try while bKash is still deciding', async () => {
    const tree = await render({ order: 'BB-7', outcome: 'pending' });
    expect(textOf(tree)).toContain('t:pending.heading');
    expect(panelOf(tree)?.awaiting).toBe(false);
  });

  it('offers no retry once the order no longer waits, whatever the word says', async () => {
    vi.mocked(findOrderByNumber).mockResolvedValue(order({ ...WAITING, status: 'CANCELLED' }));
    const tree = await render({ order: 'BB-7', outcome: 'failed' });
    expect(panelOf(tree)?.awaiting).toBe(false);
  });

  it('reads an unknown outcome as failed, never as paid', async () => {
    const tree = await render({ order: 'BB-7', outcome: 'PAID' });
    expect(textOf(tree)).toContain('t:failed.heading');
  });

  it('points to the orders when it cannot tell which order this was', async () => {
    vi.mocked(findOrderByNumber).mockResolvedValue(null);
    let tree = await render({ order: 'BB-404', outcome: 'failed' });
    expect(textOf(tree)).toContain('t:noOrder');
    expect(tree.some((el) => el.props.href === '/account/orders')).toBe(true);
    expect(panelOf(tree)).toBeUndefined();

    vi.mocked(findOrderByNumber).mockClear();
    tree = await render({ outcome: 'failed' });
    expect(findOrderByNumber).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('t:noOrder');
  });
});

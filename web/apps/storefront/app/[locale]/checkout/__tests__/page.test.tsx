import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { address } from '../../../../test/address';
import { serverCart } from '../../../../test/cart';
import { quote, slot } from '../../../../test/checkout';

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
vi.mock('../../../../lib/checkout/getCheckout', () => ({ getCheckout: vi.fn() }));
vi.mock('../../../../lib/checkout/actions', () => ({}));
vi.mock('../../../../lib/account/actions', () => ({}));
vi.mock('../../../../lib/payments/methods', () => ({ getPaymentMethods: vi.fn() }));

const { default: CheckoutPage } = await import('../page');
const { getCurrentUser } = await import('../../../../lib/auth/session');
const { getCheckout } = await import('../../../../lib/checkout/getCheckout');
const { redirect } = await import('../../../../i18n/navigation');
const { OrderSummary } = await import('../../../../components/checkout/OrderSummary');
const { AddressChooser } = await import('../../../../components/checkout/AddressChooser');
const { SlotPicker } = await import('../../../../components/checkout/SlotPicker');
const { PaymentChooser } = await import('../../../../components/checkout/PaymentChooser');
const { getPaymentMethods } = await import('../../../../lib/payments/methods');
const { AddressBook } = await import('../../../../components/account/AddressBook');
const { emptyCart, fromServerCart } = await import('../../../../lib/cart/view');

type AnyElement = ReactElement<{ children?: ReactNode; [prop: string]: unknown }>;
/** The page's own async server pieces, rendered so the test sees what they return. */
const SERVER_PARTS = new Set(['Step', 'AddressStep', 'DeliveryTimeStep', 'EmptyCheckout']);

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
const render = async (search: Record<string, string> = {}) =>
  elementsOf(
    await CheckoutPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(search),
    }),
  );
const USER = { id: 'u1', email: 'a@b.co', phoneVerified: false, role: 'CUSTOMER', createdAt: '' };
const READY = {
  cart: fromServerCart(serverCart()),
  addresses: [address()],
  selected: address(),
  quote: { ok: true as const, quote: quote() },
  slots: { ok: true as const, slots: [slot()] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(USER);
  vi.mocked(getCheckout).mockResolvedValue(READY);
  vi.mocked(getPaymentMethods).mockResolvedValue(['CASH_ON_DELIVERY', 'BKASH']);
});

describe('checkout page', () => {
  it('sends a visitor who is not signed in to sign in, and back here after', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render()).rejects.toBe(REDIRECTED);
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/checkout' } },
      locale: 'en',
    });
  });

  it('loads the checkout for the address in the link', async () => {
    await render({ address: 'addr-2' });
    expect(getCheckout).toHaveBeenCalledWith('addr-2');
  });

  it('shows the address choice, delivery windows, payment and a ready summary', async () => {
    const tree = await render();

    expect(tree.find((el) => el.type === AddressChooser)?.props).toMatchObject({
      selectedId: 'addr-1',
    });
    expect(tree.find((el) => el.type === SlotPicker)?.props.slots).toEqual([slot()]);
    expect(tree.find((el) => el.type === PaymentChooser)?.props.methods).toEqual([
      'CASH_ON_DELIVERY',
      'BKASH',
    ]);
    expect(tree.find((el) => el.type === 'textarea')?.props).toMatchObject({
      name: 'customerNote',
      form: 'place-order',
      maxLength: 500,
    });
    expect(tree.find((el) => el.type === OrderSummary)?.props).toMatchObject({
      addressId: 'addr-1',
      blocker: null,
    });
  });

  it('opens the address form when there is no address, and blocks placing', async () => {
    vi.mocked(getCheckout).mockResolvedValue({
      ...READY,
      addresses: [],
      selected: null,
      quote: null,
      slots: null,
    });
    const tree = await render();

    expect(tree.find((el) => el.type === AddressBook)?.props.addresses).toEqual([]);
    expect(tree.find((el) => el.type === SlotPicker)).toBeUndefined();
    expect(tree.find((el) => el.type === OrderSummary)?.props).toMatchObject({
      addressId: null,
      blocker: 'noAddress',
    });
  });

  it('says why an address cannot be served instead of listing windows', async () => {
    vi.mocked(getCheckout).mockResolvedValue({
      ...READY,
      slots: { ok: false, error: 'noWarehouse' },
    });
    const tree = await render();

    expect(tree.find((el) => el.props.role === 'alert')?.props.children).toBe(
      't:errors.noWarehouse',
    );
    expect(tree.find((el) => el.type === OrderSummary)?.props.blocker).toBe('noWarehouse');
  });

  it('says so when the address book could not be read', async () => {
    vi.mocked(getCheckout).mockResolvedValue({ ...READY, addresses: null, selected: null });
    const tree = await render();
    expect(tree.find((el) => el.props.role === 'alert')?.props.children).toBe('t:addressLoadError');
  });

  it('has nothing to check out with an empty or unreadable cart', async () => {
    vi.mocked(getCheckout).mockResolvedValue({ ...READY, cart: emptyCart('account') });
    let tree = await render();
    expect(tree.some((el) => el.props.children === 't:empty')).toBe(true);
    expect(tree.find((el) => el.type === OrderSummary)).toBeUndefined();

    vi.mocked(getCheckout).mockResolvedValue({ ...READY, cart: emptyCart('account', 'error') });
    tree = await render();
    expect(tree.find((el) => el.props.role === 'alert')?.props.children).toBe('t:cartLoadError');
  });
});

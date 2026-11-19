import { formatPoysha } from '@barakah/ui';

import type { ProductDetail } from '../api/catalog';
import type { Cart } from './api';
import type { GuestLine } from './guestCart';

/** One line as the drawer shows it, the same for a guest cart and an account cart. */
export interface CartLineView {
  /** What the line actions send back: the cart item id (account) or the variant id (guest). */
  key: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  variantLabel: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceFormatted: string;
  lineTotalFormatted: string;
  priceChanged: boolean;
  /** Units in stock when the line asks for more; `null` when stock is fine or unknown. */
  onlyLeft: number | null;
  /** The product or size is gone; the line can only be removed. */
  unavailable: boolean;
}

export interface CartView {
  mode: 'guest' | 'account';
  status: 'ok' | 'error';
  lines: CartLineView[];
  itemCount: number;
  subtotalFormatted: string;
  hasPriceChanges: boolean;
  hasStockIssues: boolean;
}

export const emptyCart = (mode: CartView['mode'], status: CartView['status'] = 'ok'): CartView => ({
  mode,
  status,
  lines: [],
  itemCount: 0,
  subtotalFormatted: formatPoysha(0),
  hasPriceChanges: false,
  hasStockIssues: false,
});

/** The API's cart as the drawer shows it; prices are the API's, recomputed on every read. */
export const fromServerCart = (cart: Cart): CartView => ({
  mode: 'account',
  status: 'ok',
  lines: cart.items.map((item) => ({
    key: item.id,
    slug: item.productSlug,
    nameEn: item.productNameEn,
    nameBn: item.productNameBn,
    variantLabel: item.variantNameEn,
    imageUrl: item.imageUrl,
    quantity: item.quantity,
    unitPriceFormatted: formatPoysha(item.unitPricePoysha),
    lineTotalFormatted: item.lineTotalFormatted,
    priceChanged: item.priceChanged,
    onlyLeft: item.exceedsStock ? item.availableQuantity : null,
    unavailable: false,
  })),
  itemCount: cart.itemCount,
  subtotalFormatted: cart.subtotalFormatted,
  hasPriceChanges: cart.hasPriceChanges,
  hasStockIssues: cart.hasStockIssues,
});

const guestLineView = (
  line: GuestLine,
  product: ProductDetail | null | undefined,
): CartLineView => {
  const variant = product?.variants.find((item) => item.id === line.v);
  const primary = product?.images.find((image) => image.isPrimary) ?? product?.images[0];
  return {
    key: line.v,
    slug: line.s,
    nameEn: product?.nameEn ?? line.s,
    nameBn: product?.nameBn ?? '',
    variantLabel: variant?.unitLabel ?? '',
    imageUrl: primary?.url ?? product?.primaryImage?.url ?? null,
    quantity: line.q,
    unitPriceFormatted: variant ? variant.priceFormatted : '',
    lineTotalFormatted: variant ? formatPoysha(variant.pricePoysha * line.q) : '',
    priceChanged: false,
    onlyLeft: null,
    unavailable: !variant,
  };
};

/**
 * A guest cart priced from the live catalog. The total is a display estimate: the API prices
 * the order itself at checkout, and the guest lines become account lines on sign-in first.
 */
export const fromGuestLines = (
  lines: GuestLine[],
  products: ReadonlyMap<string, ProductDetail | null>,
): CartView => {
  const views = lines.map((line) => guestLineView(line, products.get(line.s)));
  const subtotal = lines.reduce((sum, line) => {
    const variant = products.get(line.s)?.variants.find((item) => item.id === line.v);
    return variant ? sum + variant.pricePoysha * line.q : sum;
  }, 0);
  return {
    mode: 'guest',
    status: 'ok',
    lines: views,
    itemCount: lines.reduce((sum, line) => sum + line.q, 0),
    subtotalFormatted: formatPoysha(subtotal),
    hasPriceChanges: false,
    hasStockIssues: false,
  };
};

import type { Cart, CartItem } from '../lib/cart/api';

export const cartItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'item-1',
  variantId: 'v-500',
  sku: 'AJWA-500',
  productNameEn: 'Ajwa Dates',
  productNameBn: 'আজওয়া খেজুর',
  variantNameEn: '500g',
  productSlug: 'ajwa-dates',
  imageUrl: null,
  quantity: 2,
  unitPricePoysha: 125000,
  unitPricePoyshaAtAdd: 125000,
  priceChanged: false,
  lineTotalPoysha: 250000,
  lineTotalFormatted: '৳2,500.00',
  availableQuantity: 10,
  exceedsStock: false,
  ...overrides,
});

export const serverCart = (items: CartItem[] = [cartItem()]): Cart => ({
  items,
  subtotalPoysha: items.reduce((sum, item) => sum + item.lineTotalPoysha, 0),
  subtotalFormatted: '৳2,500.00',
  itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
  hasPriceChanges: items.some((item) => item.priceChanged),
  hasStockIssues: items.some((item) => item.exceedsStock),
});

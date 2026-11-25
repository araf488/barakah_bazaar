import { type CallerContext, callApi } from '../auth/api';

// Server-side client for the API's cart (src/modules/cart). Signed-in only: the API has no
// guest cart, which is why guests keep theirs in a cookie (lib/cart/guestCart.ts).

export interface CartItem {
  id: string;
  variantId: string;
  sku: string;
  productNameEn: string;
  productNameBn: string;
  variantNameEn: string;
  productSlug: string;
  imageUrl: string | null;
  quantity: number;
  unitPricePoysha: number;
  unitPricePoyshaAtAdd: number;
  priceChanged: boolean;
  lineTotalPoysha: number;
  lineTotalFormatted: string;
  availableQuantity: number;
  exceedsStock: boolean;
}

export interface Cart {
  items: CartItem[];
  subtotalPoysha: number;
  subtotalFormatted: string;
  itemCount: number;
  hasPriceChanges: boolean;
  hasStockIssues: boolean;
}

const CART_PATH = '/cart';
const ITEMS_PATH = '/cart/items';

export const cartApi = {
  get: (caller: CallerContext) => callApi<Cart>('GET', CART_PATH, caller),
  add: (caller: CallerContext, variantId: string, quantity: number) =>
    callApi<Cart>('POST', ITEMS_PATH, caller, { variantId, quantity }),
  update: (caller: CallerContext, itemId: string, quantity: number) =>
    callApi<Cart>('PATCH', `${ITEMS_PATH}/${encodeURIComponent(itemId)}`, caller, { quantity }),
  remove: (caller: CallerContext, itemId: string) =>
    callApi<Cart>('DELETE', `${ITEMS_PATH}/${encodeURIComponent(itemId)}`, caller),
};

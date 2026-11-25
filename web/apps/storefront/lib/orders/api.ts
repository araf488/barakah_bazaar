import type { Paginated } from '../api/catalog';
import { type CallerContext, callApiExplained } from '../auth/api';
import type { Order, OrderStatus } from '../checkout/api';

// Server-side client for the shopper's own orders (src/modules/order/order.controller.ts). The
// detail read lives with checkout (`checkoutApi.order`), which needed it first.

/** One page of the shopper's orders, in the API's shared list envelope. */
export type OrderPage = Paginated<Order>;

export interface OrderListQuery {
  status: OrderStatus | null;
  page: number;
  limit: number;
}

const ORDERS_PATH = '/orders';

const listPath = ({ status, page, limit }: OrderListQuery): string => {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) {
    query.set('status', status);
  }
  return `${ORDERS_PATH}?${query}`;
};

export const ordersApi = {
  /** Newest first. */
  list: (caller: CallerContext, query: OrderListQuery) =>
    callApiExplained<OrderPage>('GET', listPath(query), caller),
  /** Allowed while the order is placed or confirmed; the API answers 409 once it has moved on. */
  cancel: (caller: CallerContext, id: string, reason: string | null) =>
    callApiExplained<Order>(
      'PATCH',
      `${ORDERS_PATH}/${encodeURIComponent(id)}/cancel`,
      caller,
      reason ? { reason } : {},
    ),
};

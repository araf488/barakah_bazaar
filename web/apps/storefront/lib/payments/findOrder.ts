import { accountCaller } from '../account/caller';
import type { Order } from '../checkout/api';
import { ordersApi } from '../orders/api';

/**
 * How many of the newest orders are searched for a number. The API looks orders up by id only,
 * and the payment result page knows the number alone; the order it names was placed minutes ago,
 * so it is on the first page.
 */
export const ORDER_LOOKUP_LIMIT = 20;

/** The signed-in shopper's order with this number, or `null` when it is not among their newest. */
export const findOrderByNumber = async (orderNumber: string): Promise<Order | null> => {
  const caller = await accountCaller();
  if (!caller) {
    return null;
  }
  const result = await ordersApi.list(caller, { status: null, page: 1, limit: ORDER_LOOKUP_LIMIT });
  return result.ok ? (result.data.items.find((o) => o.orderNumber === orderNumber) ?? null) : null;
};

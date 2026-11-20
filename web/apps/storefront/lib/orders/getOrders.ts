import { accountCaller } from '../account/caller';
import { type OrderPage, ordersApi } from './api';
import { ORDERS_PAGE_SIZE, type OrderListParams, statusOfFilter } from './listQuery';

export type OrdersOutcome = { ok: true; page: OrderPage } | { ok: false };

/** One page of the signed-in shopper's orders; `ok: false` when there is no session or no API. */
export const getOrders = async (params: OrderListParams): Promise<OrdersOutcome> => {
  const caller = await accountCaller();
  if (!caller) {
    return { ok: false };
  }
  const result = await ordersApi.list(caller, {
    status: statusOfFilter(params.filter),
    page: params.page,
    limit: ORDERS_PAGE_SIZE,
  });
  return result.ok ? { ok: true, page: result.data } : { ok: false };
};

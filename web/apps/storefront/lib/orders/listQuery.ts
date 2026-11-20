import type { OrderStatus } from '../checkout/api';

/** Orders per page of the list. */
export const ORDERS_PAGE_SIZE = 10;

/**
 * The filters the list offers, each one API status (the API filters by a single status). `all`
 * is the unfiltered list. Picked for what a shopper looks for: what is on its way, what came,
 * what was called off.
 */
export const ORDER_FILTERS = ['all', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const;

export type OrderFilter = (typeof ORDER_FILTERS)[number];

export const ALL_ORDERS: OrderFilter = 'all';

export interface OrderListParams {
  filter: OrderFilter;
  page: number;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const filterOf = (value: string | undefined): OrderFilter =>
  ORDER_FILTERS.find((filter) => filter !== ALL_ORDERS && filter === value) ?? ALL_ORDERS;

const pageOf = (value: string | undefined): number => {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
};

/** The list's filter and page from the address bar; anything unknown falls back to the start. */
export const parseOrderListParams = (search: {
  status?: string | string[];
  page?: string | string[];
}): OrderListParams => ({
  filter: filterOf(first(search.status)),
  page: pageOf(first(search.page)),
});

/** The API status a filter asks for, or `null` for every order. */
export const statusOfFilter = (filter: OrderFilter): OrderStatus | null =>
  filter === ALL_ORDERS ? null : filter;

/** The query string for one page of one filter; the defaults are left out so URLs stay short. */
export const orderListQuery = ({ filter, page }: OrderListParams): Record<string, string> => ({
  ...(filter === ALL_ORDERS ? {} : { status: filter }),
  ...(page > 1 ? { page: String(page) } : {}),
});

import { accountCaller } from '../account/caller';
import { checkoutApi, type Order } from './api';

/** One of the signed-in shopper's orders, or `null` when it is not theirs, gone, or unreadable. */
export const getOrder = async (id: string): Promise<Order | null> => {
  const caller = await accountCaller();
  if (!caller) {
    return null;
  }
  const result = await checkoutApi.order(caller, id);
  return result.ok ? result.data : null;
};

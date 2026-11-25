import type { CheckoutErrorKey } from './errors';
import type { CheckoutData } from './getCheckout';

/**
 * Why the order cannot be placed as the page stands, or `null` when it can. Checked in the order
 * the shopper would fix them: an address first, then whether it can be served, then the basket.
 */
export const checkoutBlocker = ({
  cart,
  selected,
  quote,
  slots,
}: CheckoutData): CheckoutErrorKey | null => {
  if (!selected) return 'noAddress';
  if (quote && !quote.ok) return quote.error;
  if (slots && !slots.ok) return slots.error;
  if (cart.hasStockIssues || cart.lines.some((line) => line.unavailable)) return 'stock';
  return null;
};

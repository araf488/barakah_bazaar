import type { CallerContext } from '../auth/api';
import type { CookieWriter } from '../auth/cookies';
import { cartApi } from './api';
import { GUEST_CART_COOKIE, parseGuestCart } from './guestCart';

/**
 * Moves a guest cart into the account's cart right after sign-in. Each line is added through
 * the API, which sums it with any line already there and checks stock. Lines the API refuses
 * (gone, out of stock) are dropped with the rest: the guest cookie is cleared either way.
 * Sequential on purpose, so the API's line cap is applied in the guest's order.
 */
export const mergeGuestCart = async (
  jar: CookieWriter & { get(name: string): { value: string } | undefined },
  caller: CallerContext,
): Promise<{ moved: number; refused: number }> => {
  const lines = parseGuestCart(jar.get(GUEST_CART_COOKIE)?.value);
  let moved = 0;
  for (const line of lines) {
    const result = await cartApi.add(caller, line.v, line.q);
    if (result.ok) {
      moved += 1;
    }
  }
  if (lines.length > 0) {
    jar.delete(GUEST_CART_COOKIE);
  }
  return { moved, refused: lines.length - moved };
};

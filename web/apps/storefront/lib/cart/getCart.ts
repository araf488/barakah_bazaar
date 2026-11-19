import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { getProductBySlug, type ProductDetail } from '../api/catalog';
import { SESSION_COOKIE } from '../auth/cookies';
import { getCurrentUser } from '../auth/session';
import { cartApi } from './api';
import { GUEST_CART_COOKIE, parseGuestCart } from './guestCart';
import { type CartView, emptyCart, fromGuestLines, fromServerCart } from './view';

const guestCart = async (raw: string | undefined): Promise<CartView> => {
  const lines = parseGuestCart(raw);
  if (lines.length === 0) {
    return emptyCart('guest');
  }
  const slugs = [...new Set(lines.map((line) => line.s))];
  const results = await Promise.all(slugs.map((slug) => getProductBySlug(slug)));
  const products = new Map<string, ProductDetail | null>(
    slugs.map((slug, i) => {
      const result = results[i];
      return [slug, result?.ok ? result.product : null];
    }),
  );
  return fromGuestLines(lines, products);
};

/**
 * The visitor's cart for this render: the API's cart once signed in, the guest cookie before.
 * Cached per request, so the header badge and the drawer share one read.
 */
export const getCart = cache(async (): Promise<CartView> => {
  const [user, jar, incoming] = await Promise.all([getCurrentUser(), cookies(), headers()]);
  if (!user) {
    return guestCart(jar.get(GUEST_CART_COOKIE)?.value);
  }
  const accessToken = jar.get(SESSION_COOKIE.access)?.value ?? '';
  const deviceId = jar.get(SESSION_COOKIE.device)?.value ?? '';
  const result = await cartApi.get({
    deviceId,
    accessToken,
    userAgent: incoming.get('user-agent'),
  });
  return result.ok ? fromServerCart(result.data) : emptyCart('account', 'error');
});

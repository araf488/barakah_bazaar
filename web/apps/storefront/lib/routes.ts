/**
 * Every storefront path, locale-free: the i18n `Link` adds `/bn` or `/en`. Pages that are not
 * built yet are listed too, so links point at their final address from the start.
 */
export const ROUTES = {
  home: '/',
  fresh: '/fresh',
  signIn: '/sign-in',
  register: '/register',
  account: '/account',
  orders: '/account/orders',
  security: '/account/security',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  checkout: '/checkout',
  /** Where the API's bKash callback sends the browser (PaymentConstants.ResultPath). */
  paymentResult: '/checkout/payment-result',
} as const;

export type LivePage =
  | 'category'
  | 'product'
  | 'fresh'
  | 'signIn'
  | 'register'
  | 'account'
  | 'orders'
  | 'security'
  | 'checkout';

/**
 * Which pages exist today. A link is rendered only when its destination does, so the shell never
 * sends a visitor to a 404 (antislop R-24). Flip an entry in the same change that ships the page.
 * Tests may override entries; production code only reads them.
 */
export const LIVE_PAGES: Record<LivePage, boolean> = {
  category: false,
  product: true,
  fresh: false,
  signIn: true,
  register: true,
  account: true,
  orders: true,
  security: true,
  checkout: true,
};

/** One of the shopper's orders: its history, items and the cancel button while allowed. */
export const orderPath = (orderId: string): string =>
  `${ROUTES.orders}/${encodeURIComponent(orderId)}`;

/** The page a just-placed order opens on. */
export const orderPlacedPath = (orderId: string): string =>
  `${ROUTES.checkout}/placed/${encodeURIComponent(orderId)}`;

export const categoryPath = (slug: string): string => `/c/${encodeURIComponent(slug)}`;

export const productPath = (slug: string): string => `/p/${encodeURIComponent(slug)}`;

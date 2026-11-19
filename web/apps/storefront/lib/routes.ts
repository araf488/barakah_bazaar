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
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
} as const;

export type LivePage =
  'category' | 'product' | 'fresh' | 'signIn' | 'register' | 'account' | 'orders';

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
  account: false,
  orders: false,
};

export const categoryPath = (slug: string): string => `/c/${encodeURIComponent(slug)}`;

export const productPath = (slug: string): string => `/p/${encodeURIComponent(slug)}`;

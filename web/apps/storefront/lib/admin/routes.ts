import { ROUTES } from '../routes';

/** Every admin path. The portal has no locale prefix: its chrome is English only. */
export const ADMIN_ROUTES = {
  home: '/admin',
  signIn: '/admin/sign-in',
  verify: '/admin/sign-in/verify',
  setup: '/admin/sign-in/setup',
  /** Where the API's invitation email links (`AdminConstants.InvitationAcceptPath`). */
  acceptInvitation: '/admin/accept-invitation',
} as const;

/**
 * Storefront pages the portal links to, in English to match the portal. Plain links, not the
 * storefront's locale-aware ones: the portal sits outside every locale.
 */
export const SHOP_ROUTES = {
  home: `/en${ROUTES.home}`,
  forgotPassword: `/en${ROUTES.forgotPassword}`,
} as const;

/** The query parameter carrying where to go after signing in. */
export const NEXT_PARAM = 'next';

/**
 * Where to go after signing in: an admin path from the `next` field, or the overview. Anything
 * outside `/admin`, or shaped like `//evil.example` or `/admin\..`, goes to the overview.
 */
export const safeAdminNext = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.startsWith('//') ||
    value.includes('\\') ||
    !(value === ADMIN_ROUTES.home || value.startsWith(`${ADMIN_ROUTES.home}/`))
  ) {
    return ADMIN_ROUTES.home;
  }
  return value;
};

/** The sign-in page, remembering where the staff member was going. */
export const signInPathFor = (next: string): string => {
  const target = safeAdminNext(next);
  return target === ADMIN_ROUTES.home
    ? ADMIN_ROUTES.signIn
    : `${ADMIN_ROUTES.signIn}?${new URLSearchParams({ [NEXT_PARAM]: target })}`;
};

import { MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { CategoryNode } from '../../lib/api/catalog';
import { signOutAction } from '../../lib/auth/actions';
import type { AuthUser } from '../../lib/auth/api';
import type { CartView } from '../../lib/cart/view';
import type { DeliveryContext } from '../../lib/checkout/deliveryContext';
import { CartDrawer } from '../cart/CartDrawer';
import { LIVE_PAGES, ROUTES } from '../../lib/routes';
import { BrandMark } from './BrandMark';
import { CategoryNav } from './CategoryNav';
import { HeaderSearch } from './HeaderSearch';
import { LocaleSwitcher } from './LocaleSwitcher';

/** First name for the greeting; the email's local part when no name was given. */
const firstNameOf = (user: AuthUser): string =>
  user.fullName?.trim().split(/\s+/)[0] || user.email.split('@')[0] || user.email;

/** Where the default address is, linking to the address book; wide screens only, for room. */
function DeliveryArea({ place }: { place: string }) {
  const t = useTranslations('header');

  return (
    <Link
      href={ROUTES.account}
      aria-label={t('deliveringToLabel', { place })}
      className="hidden min-h-11 max-w-48 items-center gap-1.5 rounded-full px-2 text-sm text-subtle transition-colors hover:text-brand xl:inline-flex"
    >
      <MapPin aria-hidden="true" size={16} className="shrink-0 text-brand" />
      <span className="truncate">{t('deliveringTo', { place })}</span>
    </Link>
  );
}

/** Signed in: a greeting that opens the account page, and a sign-out button (a form, so it works without JavaScript). */
function SignedIn({ user, delivery }: { user: AuthUser; delivery: DeliveryContext | null }) {
  const t = useTranslations('auth');

  return (
    <div className="hidden items-center gap-2 md:flex">
      {delivery ? <DeliveryArea place={delivery.place} /> : null}
      <Link
        href={ROUTES.account}
        className="inline-flex min-h-11 max-w-40 items-center truncate px-2 text-sm font-medium text-ink underline-offset-4 transition-colors hover:text-brand hover:underline"
      >
        {t('greeting', { name: firstNameOf(user) })}
      </Link>
      <form action={signOutAction}>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium text-subtle transition hover:border-brand hover:bg-warm hover:text-brand active:scale-95"
        >
          {t('signOut')}
        </button>
      </form>
    </div>
  );
}

/** Signed out: sign-in and registration, each shown once its page exists. */
function AccountLinks({
  user,
  delivery,
}: {
  user: AuthUser | null;
  delivery: DeliveryContext | null;
}) {
  const t = useTranslations('header');

  if (user) {
    return <SignedIn user={user} delivery={delivery} />;
  }

  return (
    <div className="hidden items-center gap-2 md:flex">
      {LIVE_PAGES.signIn ? (
        <Link
          href={ROUTES.signIn}
          className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-ink underline-offset-4 transition-colors hover:text-brand hover:underline"
        >
          {t('signIn')}
        </Link>
      ) : null}
      {LIVE_PAGES.register ? (
        <Link
          href={ROUTES.register}
          className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-light active:scale-95"
        >
          {t('join')}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The sticky header: logo, search, language, account and cart, with the category row beneath.
 * Links to pages that do not exist yet stay hidden (`LIVE_PAGES`), so early on this is the logo,
 * search and the language switch.
 */
export function SiteHeader({
  categories,
  user,
  cart,
  delivery = null,
}: {
  categories: CategoryNode[];
  user: AuthUser | null;
  cart: CartView;
  /** The default address's area and the cart's delivery fee; `null` for guests. */
  delivery?: DeliveryContext | null;
}) {
  const shell = useTranslations('shell');

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-white/95 shadow-sm shadow-brand/5 backdrop-blur-md">
      {/* Full width: the brand and search hold the left edge, the actions the right edge. */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-4 lg:gap-8">
          <div className="flex min-w-0 flex-1 items-center gap-4 lg:gap-8">
            <Link
              href={ROUTES.home}
              aria-label={shell('homeLink')}
              className="flex min-h-11 shrink-0 items-center rounded-xl transition-opacity hover:opacity-80"
            >
              <BrandMark tone="onLight" />
            </Link>
            <HeaderSearch />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-4">
            <LocaleSwitcher />
            <AccountLinks user={user} delivery={delivery} />
            <CartDrawer cart={cart} delivery={delivery} />
          </div>
        </div>
        <CategoryNav categories={categories} />
      </div>
    </header>
  );
}

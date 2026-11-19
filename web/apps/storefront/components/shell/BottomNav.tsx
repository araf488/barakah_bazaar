'use client';

import { formatCount } from '@barakah/ui';
import { House, LogIn, LogOut, Search, ShoppingBag } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link, usePathname } from '../../i18n/navigation';
import { signOutAction } from '../../lib/auth/actions';
import { openCart } from '../../lib/cartEvents';
import { ROUTES } from '../../lib/routes';
import { openSearch } from '../../lib/searchEvents';

const ITEM =
  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-subtle transition-colors hover:text-brand active:bg-warm aria-[current=page]:text-brand';

function Item({ icon, label, badge }: { icon: ReactNode; label: string; badge?: string }) {
  return (
    <>
      <span className="relative">
        {icon}
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-brand-dark"
          >
            {badge}
          </span>
        ) : null}
      </span>
      {label}
    </>
  );
}

/**
 * Phones only: Home, Search, Cart and Account within thumb reach, as Ghorer Bazar and Cartup
 * do. The header hides its own cart and search buttons below this breakpoint so nothing shows
 * twice. Account is sign-in or sign-out until an account page exists.
 */
export function BottomNav({ cartCount, signedIn }: { cartCount: number; signedIn: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const onHome = usePathname() === ROUTES.home;
  const badge = cartCount > 0 ? formatCount(cartCount, locale) : undefined;

  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <Link href={ROUTES.home} aria-current={onHome ? 'page' : undefined} className={ITEM}>
        <Item icon={<House aria-hidden="true" size={20} />} label={t('header.home')} />
      </Link>
      <button type="button" onClick={() => openSearch()} className={ITEM}>
        <Item icon={<Search aria-hidden="true" size={20} />} label={t('nav.search')} />
      </button>
      <button
        type="button"
        onClick={openCart}
        aria-label={t('cart.open', { count: cartCount })}
        className={ITEM}
      >
        <Item
          icon={<ShoppingBag aria-hidden="true" size={20} />}
          label={t('nav.cart')}
          {...(badge ? { badge } : {})}
        />
      </button>
      {signedIn ? (
        <form action={signOutAction} className="flex flex-1">
          <button type="submit" className={ITEM}>
            <Item icon={<LogOut aria-hidden="true" size={20} />} label={t('auth.signOut')} />
          </button>
        </form>
      ) : (
        <Link href={ROUTES.signIn} className={ITEM}>
          <Item icon={<LogIn aria-hidden="true" size={20} />} label={t('header.signIn')} />
        </Link>
      )}
    </nav>
  );
}

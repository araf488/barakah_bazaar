'use client';

import { ShoppingBag, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef } from 'react';

import { Link, usePathname } from '../../i18n/navigation';
import { OPEN_CART_EVENT } from '../../lib/cartEvents';
import type { CartView } from '../../lib/cart/view';
import { homeFilterHref } from '../../lib/homeFilter';
import { ROUTES } from '../../lib/routes';
import { CartLine } from './CartLine';

/** The cart's footer: subtotal, the delivery fee left to checkout, and the next step. */
function CartSummary({ cart, onNavigate }: { cart: CartView; onNavigate: () => void }) {
  const t = useTranslations('cart');
  const pathname = usePathname();

  return (
    <div className="space-y-3 border-t border-border p-5">
      {cart.hasPriceChanges ? (
        <p className="rounded-xl bg-gold/10 px-3 py-2 text-xs text-ink">{t('priceNotice')}</p>
      ) : null}
      {cart.hasStockIssues ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{t('stockNotice')}</p>
      ) : null}
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-subtle">{t('subtotal')}</dt>
          <dd className="font-display text-lg font-bold text-ink">{cart.subtotalFormatted}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-subtle">{t('delivery')}</dt>
          <dd className="text-subtle">{t('deliveryAtCheckout')}</dd>
        </div>
      </dl>
      {cart.mode === 'guest' ? (
        <>
          <Link
            href={{ pathname: ROUTES.signIn, query: { next: pathname } }}
            onClick={onNavigate}
            className="flex min-h-12 items-center justify-center rounded-2xl bg-brand px-6 font-semibold text-white transition hover:bg-brand-light active:scale-[0.98]"
          >
            {t('guestCheckout')}
          </Link>
          <p className="text-center text-xs text-subtle">{t('guestNote')}</p>
        </>
      ) : (
        <p className="text-center text-xs text-subtle">{t('checkoutSoon')}</p>
      )}
    </div>
  );
}

/** The cart body for each state: load error, empty, or lines with their summary. */
function CartBody({ cart, onNavigate }: { cart: CartView; onNavigate: () => void }) {
  const t = useTranslations('cart');

  if (cart.status === 'error') {
    return (
      <p role="alert" className="p-8 text-center text-sm text-subtle">
        {t('loadError')}
      </p>
    );
  }
  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <ShoppingBag aria-hidden="true" size={40} className="text-border" />
        <p className="text-sm text-subtle">{t('empty')}</p>
        <Link
          href={homeFilterHref({ kind: 'all' })}
          onClick={onNavigate}
          className="inline-flex min-h-11 items-center rounded-full border-2 border-brand px-6 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white active:scale-95"
        >
          {t('emptyAction')}
        </Link>
      </div>
    );
  }
  return (
    <>
      <ul className="flex-1 overflow-y-auto px-5">
        {cart.lines.map((line) => (
          <CartLine key={line.key} line={line} />
        ))}
      </ul>
      <CartSummary cart={cart} onNavigate={onNavigate} />
    </>
  );
}

/**
 * The header's cart pill and the drawer it opens: a native modal <dialog>, so focus is trapped,
 * the page behind is inert and Escape closes it. Any control can open it (`openCart()`), as the
 * product page does after adding. Delivery is left to checkout: the fee depends on the address,
 * so the Figma's flat ৳80 and free-over-৳1,000 bar would be guesses.
 */
export function CartDrawer({ cart }: { cart: CartView }) {
  const t = useTranslations('cart');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = useCallback(() => {
    if (!dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, []);
  const close = useCallback(() => dialogRef.current?.close(), []);

  useEffect(() => {
    window.addEventListener(OPEN_CART_EVENT, open);
    return () => window.removeEventListener(OPEN_CART_EVENT, open);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={t('open', { count: cart.itemCount })}
        className="relative flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-light active:scale-95"
      >
        <ShoppingBag aria-hidden="true" size={18} />
        {cart.itemCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 animate-scale-in items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-brand-dark"
          >
            {cart.itemCount}
          </span>
        ) : null}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="cart-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            close();
          }
        }}
        className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-md bg-white p-0 shadow-2xl backdrop:bg-ink/50 open:flex open:animate-slide-right open:flex-col"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="cart-title" className="font-display text-xl font-semibold text-ink">
            {t('title')}{' '}
            <span className="font-sans text-sm font-normal text-subtle">
              ({t('count', { count: cart.itemCount })})
            </span>
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t('close')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-warm text-subtle transition hover:bg-border hover:text-ink active:scale-95"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <CartBody cart={cart} onNavigate={close} />
      </dialog>
    </>
  );
}

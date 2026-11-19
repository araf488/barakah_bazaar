'use client';

import { Minus, Plus, ShoppingBag } from 'lucide-react';
import { formatCount } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { type AddToCartState, addToCartAction } from '../../lib/cart/actions';
import { MAX_QUANTITY_PER_LINE } from '../../lib/cart/guestCart';
import { openCart } from '../../lib/cartEvents';

const IDLE: AddToCartState = { status: 'idle' };
const STEP =
  'flex h-11 w-11 items-center justify-center rounded-lg font-bold transition hover:bg-white active:scale-90 disabled:opacity-40';

function SubmitAdd() {
  const t = useTranslations('cart');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-6 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light active:scale-[0.98] disabled:opacity-70"
    >
      <ShoppingBag aria-hidden="true" size={18} />
      {pending ? t('adding') : t('add')}
    </button>
  );
}

/**
 * Quantity and "Add to cart" for the selected size. Works for guests too (their cart lives in a
 * cookie until they sign in). On success the cart drawer opens, so the shopper sees what changed,
 * and the quantity goes back to one so the next add is not silently doubled.
 */
export function AddToCart({
  slug,
  variantId,
  priceLabel,
}: {
  slug: string;
  variantId: string;
  /** The selected size's price, repeated in the sticky bar. */
  priceLabel: string;
}) {
  const t = useTranslations('cart');
  const locale = useLocale();
  const [state, action] = useActionState(addToCartAction, IDLE);
  const [quantity, setQuantity] = useState(1);
  const formId = useId();
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainOutOfView, setMainOutOfView] = useState(false);

  // Phones: once the main button scrolls away, a bar with the price and the same button sticks
  // above the bottom navigation (Cartup's pattern), so a long product page never loses its action.
  useEffect(() => {
    const target = mainRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setMainOutOfView(entry ? !entry.isIntersecting : false),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (state.status === 'added') {
      setQuantity(1);
      openCart();
    }
  }, [state]);

  return (
    <form id={formId} action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value={quantity} />
      <div ref={mainRef} className="flex items-center gap-3">
        <div
          role="group"
          aria-label={t('quantity')}
          className="flex items-center rounded-xl border border-border bg-warm p-0.5"
        >
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label={t('fewer')}
            className={STEP}
          >
            <Minus aria-hidden="true" size={14} />
          </button>
          <span aria-live="polite" className="w-10 text-center font-semibold">
            {formatCount(quantity, locale)}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY_PER_LINE, q + 1))}
            disabled={quantity >= MAX_QUANTITY_PER_LINE}
            aria-label={t('more')}
            className={STEP}
          >
            <Plus aria-hidden="true" size={14} />
          </button>
        </div>
        <SubmitAdd />
      </div>
      {state.status === 'error' ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {state.status === 'added' ? (
        <p role="status" className="sr-only">
          {t('added')}
        </p>
      ) : null}
      {mainOutOfView ? (
        <div
          data-sticky-buy
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex animate-slide-up items-center gap-3 border-t border-border bg-white/95 px-4 py-2 backdrop-blur-md md:hidden"
        >
          <span className="font-display text-lg font-bold text-brand">{priceLabel}</span>
          <button
            type="submit"
            form={formId}
            className="ml-auto flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-light active:scale-95"
          >
            <ShoppingBag aria-hidden="true" size={16} />
            {t('add')}
          </button>
        </div>
      ) : null}
    </form>
  );
}

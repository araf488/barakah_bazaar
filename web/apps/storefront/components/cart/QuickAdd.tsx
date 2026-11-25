'use client';

import { formatCount } from '@barakah/ui';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { type AddToCartState, quickAddAction, setQuantityAction } from '../../lib/cart/actions';
import { MAX_QUANTITY_PER_LINE } from '../../lib/cart/guestCart';
import type { CartLineView } from '../../lib/cart/view';
import { openCart } from '../../lib/cartEvents';

const IDLE: AddToCartState = { status: 'idle' };
const ROUND =
  'flex h-11 w-11 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-60';

function PlusButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      className={`${ROUND} border-2 border-brand bg-white text-brand shadow-md hover:bg-brand hover:text-white`}
    >
      <Plus aria-hidden="true" size={20} />
    </button>
  );
}

function StepForm({
  lineKey,
  quantity,
  label,
  children,
}: {
  lineKey: string;
  quantity: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <form action={setQuantityAction}>
      <input type="hidden" name="key" value={lineKey} />
      <input type="hidden" name="quantity" value={quantity} />
      <StepButton label={label}>{children}</StepButton>
    </form>
  );
}

function StepButton({ label, children }: { label: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      className={`${ROUND} text-white hover:bg-brand-light`}
    >
      {children}
    </button>
  );
}

interface QuickAddProps {
  slug: string;
  name: string;
  /** This product's lines already in the cart. */
  lines: CartLineView[];
}

/**
 * The card's quick add, as shoppers know it from Chaldal: a "+" over the image adds one; once
 * the product is in the cart the "+" becomes a − n + stepper for that line. A product with
 * several sizes in the cart shows the count and opens the cart, since one stepper cannot say
 * which size it changes.
 */
export function QuickAdd({ slug, name, lines }: QuickAddProps) {
  const t = useTranslations('cart');
  const locale = useLocale();
  const [state, action] = useActionState(quickAddAction, IDLE);
  const [line, ...more] = lines;

  if (line && more.length > 0) {
    const total = lines.reduce((sum, item) => sum + item.quantity, 0);
    return (
      <button
        type="button"
        onClick={openCart}
        className="flex min-h-11 items-center rounded-full bg-brand px-4 text-xs font-semibold text-white shadow-md transition hover:bg-brand-light active:scale-95"
      >
        {t('inCartMany', { count: total })}
      </button>
    );
  }

  if (line) {
    return (
      <div
        role="group"
        aria-label={t('quantity')}
        className="flex items-center rounded-full bg-brand shadow-md"
      >
        <StepForm lineKey={line.key} quantity={line.quantity - 1} label={t('decrease', { name })}>
          <Minus aria-hidden="true" size={16} />
        </StepForm>
        <span aria-live="polite" className="min-w-6 text-center text-sm font-bold text-white">
          {formatCount(line.quantity, locale)}
        </span>
        {line.quantity < MAX_QUANTITY_PER_LINE ? (
          <StepForm lineKey={line.key} quantity={line.quantity + 1} label={t('increase', { name })}>
            <Plus aria-hidden="true" size={16} />
          </StepForm>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="slug" value={slug} />
      <PlusButton label={t('quickAdd', { name })} />
      {state.status === 'error' ? (
        <p
          role="alert"
          className="max-w-40 rounded-lg bg-white px-2 py-1 text-right text-[11px] font-medium text-red-800 shadow"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  );
}

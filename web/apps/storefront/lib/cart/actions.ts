'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';

import { callerFromAction } from '../auth/caller';
import { COOKIE_BASE, SESSION_COOKIE } from '../auth/cookies';
import { getCurrentUser } from '../auth/session';
import { cartApi } from './api';
import {
  addGuestLine,
  GUEST_CART_COOKIE,
  GUEST_CART_MAX_AGE_SECONDS,
  type GuestLine,
  MAX_QUANTITY_PER_LINE,
  parseGuestCart,
  serializeGuestCart,
  setGuestQuantity,
} from './guestCart';

/** Message keys under `cart.errors`. */
export type CartErrorKey = 'unavailable' | 'stock' | 'guestFull' | 'quantity' | 'failed';

export type AddToCartState =
  { status: 'idle' } | { status: 'added'; at: number } | { status: 'error'; error: CartErrorKey };

const NOT_FOUND = 404;
const CONFLICT = 409;

const errorFor = (status: number): CartErrorKey => {
  if (status === NOT_FOUND) return 'unavailable';
  if (status === CONFLICT) return 'stock';
  return 'failed';
};

const quantityOf = (form: FormData): number | null => {
  const quantity = Number(form.get('quantity'));
  return Number.isInteger(quantity) && quantity >= 0 && quantity <= MAX_QUANTITY_PER_LINE
    ? quantity
    : null;
};

type Jar = Awaited<ReturnType<typeof cookies>>;

const writeGuest = (jar: Jar, lines: GuestLine[]): void => {
  if (lines.length === 0) {
    jar.delete(GUEST_CART_COOKIE);
    return;
  }
  jar.set(GUEST_CART_COOKIE, serializeGuestCart(lines), {
    ...COOKIE_BASE,
    maxAge: GUEST_CART_MAX_AGE_SECONDS,
  });
};

/** The caller for an account cart call, or `null` for a guest. */
const accountCaller = async (jar: Jar) => {
  if (!(await getCurrentUser())) {
    return null;
  }
  return {
    ...(await callerFromAction()),
    accessToken: jar.get(SESSION_COOKIE.access)?.value ?? '',
  };
};

/** Adds a size of a product: to the account's cart when signed in, to the guest cookie otherwise. */
export async function addToCartAction(
  _prev: AddToCartState,
  form: FormData,
): Promise<AddToCartState> {
  const slug = String(form.get('slug') ?? '');
  const variantId = String(form.get('variantId') ?? '');
  const quantity = quantityOf(form);
  if (!slug || !variantId || !quantity) {
    return { status: 'error', error: 'quantity' };
  }
  const jar = await cookies();
  const caller = await accountCaller(jar);
  if (caller) {
    const result = await cartApi.add(caller, variantId, quantity);
    if (!result.ok) {
      return { status: 'error', error: errorFor(result.status) };
    }
    refresh();
    return { status: 'added', at: Date.now() };
  }
  const change = addGuestLine(parseGuestCart(jar.get(GUEST_CART_COOKIE)?.value), {
    s: slug,
    v: variantId,
    q: quantity,
  });
  if (!change.ok) {
    return { status: 'error', error: change.error };
  }
  writeGuest(jar, change.lines);
  refresh();
  return { status: 'added', at: Date.now() };
}

/**
 * Sets a line's quantity (absolute, as the API's PATCH is); zero removes the line. `key` is the
 * cart item id for an account and the variant id for a guest, as the drawer was given them.
 */
export async function setQuantityAction(form: FormData): Promise<void> {
  const key = String(form.get('key') ?? '');
  const quantity = quantityOf(form);
  if (!key || quantity === null) {
    return;
  }
  const jar = await cookies();
  const caller = await accountCaller(jar);
  if (caller) {
    await (quantity === 0 ? cartApi.remove(caller, key) : cartApi.update(caller, key, quantity));
  } else {
    writeGuest(
      jar,
      setGuestQuantity(parseGuestCart(jar.get(GUEST_CART_COOKIE)?.value), key, quantity),
    );
  }
  // An account change touches no cookie, and Next only re-renders after an action that sets one
  // or revalidates; this redraws the header badge and the drawer either way.
  refresh();
}

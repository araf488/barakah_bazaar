/**
 * A guest's cart, kept in the browser as an httpOnly cookie (user's choice 2026-11-19: guests
 * keep a local cart that moves to the server cart on sign-in). A cookie rather than
 * localStorage, so the server can render it and merge it inside the sign-in action itself.
 */
export const GUEST_CART_COOKIE = 'bb_guest_cart';

/** A browser cookie holds about 4 KB; twenty lines of slug, variant id and quantity fit. */
export const GUEST_CART_MAX_LINES = 20;

/** Same cap the API puts on one line (CartConstants.MaxQuantityPerLine). */
export const MAX_QUANTITY_PER_LINE = 99;

/** A guest cart lasts a month without a visit. */
export const GUEST_CART_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** One line: product slug (to look the product up), variant id, quantity. Short keys keep the cookie small. */
export interface GuestLine {
  s: string;
  v: string;
  q: number;
}

const isLine = (value: unknown): value is GuestLine => {
  const line = value as Partial<GuestLine> | null;
  return (
    typeof line === 'object' &&
    line !== null &&
    typeof line.s === 'string' &&
    typeof line.v === 'string' &&
    Number.isInteger(line.q) &&
    (line.q ?? 0) >= 1
  );
};

const clampQuantity = (quantity: number): number =>
  Math.min(Math.max(quantity, 1), MAX_QUANTITY_PER_LINE);

/** Reads the cookie; anything malformed or tampered with yields an empty or trimmed cart. */
export const parseGuestCart = (raw: string | undefined): GuestLine[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seen = new Set<string>();
    return parsed
      .filter(isLine)
      .filter((line) => !seen.has(line.v) && seen.add(line.v))
      .slice(0, GUEST_CART_MAX_LINES)
      .map((line) => ({ s: line.s, v: line.v, q: clampQuantity(line.q) }));
  } catch {
    return [];
  }
};

export const serializeGuestCart = (lines: GuestLine[]): string => JSON.stringify(lines);

export type GuestCartChange = { ok: true; lines: GuestLine[] } | { ok: false; error: 'guestFull' };

/** Adds to an existing line (as the API does) or appends one, within the caps. */
export const addGuestLine = (lines: GuestLine[], line: GuestLine): GuestCartChange => {
  const existing = lines.find((item) => item.v === line.v);
  if (existing) {
    return {
      ok: true,
      lines: lines.map((item) =>
        item.v === line.v ? { ...item, q: clampQuantity(item.q + line.q) } : item,
      ),
    };
  }
  if (lines.length >= GUEST_CART_MAX_LINES) {
    return { ok: false, error: 'guestFull' };
  }
  return { ok: true, lines: [...lines, { ...line, q: clampQuantity(line.q) }] };
};

/** Sets a line's quantity; zero or less removes it. */
export const setGuestQuantity = (
  lines: GuestLine[],
  variantId: string,
  quantity: number,
): GuestLine[] =>
  quantity < 1
    ? lines.filter((item) => item.v !== variantId)
    : lines.map((item) => (item.v === variantId ? { ...item, q: clampQuantity(quantity) } : item));

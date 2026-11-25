import type { AppLocale } from './locale';
import { formatPoysha } from './poysha';

export interface MoneyProps {
  /** Integer poysha. The only computational representation of a price. */
  poysha: number;
  /** `priceFormatted` from the API. Preferred when present so server and client agree. */
  formatted?: string;
  /** Digits to render in when formatting from `poysha` (Bengali digits for `bn`). */
  locale?: AppLocale;
}

export const Money = ({ poysha, formatted, locale }: MoneyProps) => (
  <span data-poysha={poysha}>{formatted ?? formatPoysha(poysha, locale)}</span>
);

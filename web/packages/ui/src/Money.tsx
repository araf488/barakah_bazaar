import { formatPoysha } from './poysha';

export interface MoneyProps {
  /** Integer poysha. The only computational representation of a price. */
  poysha: number;
  /** `priceFormatted` from the API. Preferred when present so server and client agree. */
  formatted?: string;
}

export const Money = ({ poysha, formatted }: MoneyProps) => (
  <span data-poysha={poysha}>{formatted ?? formatPoysha(poysha)}</span>
);

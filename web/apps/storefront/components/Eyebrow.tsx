import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';

/**
 * The small label above each section title, the Figma's recurring motif. Tracked capitals only
 * in English: Bengali has no case, and letter-spacing pulls its conjuncts apart.
 */
export function Eyebrow({ className, children }: { className: string; children: ReactNode }) {
  const locale = useLocale();
  const latinOnly = locale === 'en' ? 'tracking-[0.2em] uppercase' : '';

  return <p className={`text-xs font-bold ${latinOnly} ${className}`}>{children}</p>;
}

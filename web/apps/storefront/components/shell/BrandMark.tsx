import { BRAND_GLYPH, BRAND_SUBMARK, BRAND_WORDMARK } from '../../lib/brand';

export type BrandTone = 'onLight' | 'onDark';

/** The wordmark colour per background: brand green on the header, white on the footer. */
const WORDMARK_CLASS: Record<BrandTone, string> = {
  onLight: 'text-brand',
  onDark: 'text-white',
};

/**
 * The logo lockup: crescent tile, "Barakah" over a tracked "BAZAAR". Decorative text only; the
 * link around it carries the accessible name.
 */
export function BrandMark({ tone }: { tone: BrandTone }) {
  return (
    <span className="flex items-center gap-2.5" aria-hidden="true">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand shadow-md">
        <span className="text-lg leading-none text-gold">{BRAND_GLYPH}</span>
      </span>
      <span lang="en">
        <span
          className={`block font-display text-lg leading-none font-semibold ${WORDMARK_CLASS[tone]}`}
        >
          {BRAND_WORDMARK}
        </span>
        <span className="mt-0.5 block text-[9px] leading-none font-bold tracking-[0.2em] text-gold uppercase">
          {BRAND_SUBMARK}
        </span>
      </span>
    </span>
  );
}

import { Snowflake } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Eyebrow } from '../Eyebrow';
import { headingTags } from '../richText';
import { SearchButton } from '../SearchButton';

/** The two hero image widths shipped in public/; the browser picks one by viewport. */
const HERO_IMAGE = {
  src: '/images/home/hero-1000.webp',
  srcSet: '/images/home/hero-600.webp 600w, /images/home/hero-1000.webp 1000w',
  sizes: '(min-width: 1024px) 45vw, 100vw',
  width: 1000,
  height: 1200,
} as const;

/**
 * Brand panel with the headline and one action, beside a market photograph. The Figma's
 * customer counts, rating average and "HFBT Certified" badge are gone: none has a source. The
 * floating card states the one delivery fact the API guarantees (cold-chain slots).
 */
export function Hero() {
  const t = useTranslations('home.hero');

  return (
    <section className="grid grid-cols-1 lg:min-h-[80vh] lg:grid-cols-[55fr_45fr]">
      <div className="flex items-center bg-brand px-6 py-16 sm:px-12 lg:px-16 lg:py-20 xl:px-20">
        <div className="max-w-xl animate-fade-in">
          <Eyebrow className="mb-6 inline-flex items-center gap-2 text-gold-light">
            <span aria-hidden="true" className="hidden h-px w-8 bg-gold/60 sm:inline-block" />
            {t('eyebrow')}
            <span aria-hidden="true" className="hidden h-px w-8 bg-gold/60 sm:inline-block" />
          </Eyebrow>
          <h1 className="mb-6 font-display text-5xl leading-[1.1] text-white sm:text-6xl xl:text-7xl">
            {t.rich('title', headingTags('text-gold'))}
          </h1>
          <p className="mb-10 max-w-md text-lg leading-relaxed text-white/80">{t('body')}</p>
          <SearchButton className="inline-flex min-h-12 items-center rounded-full bg-gold px-8 font-semibold text-brand-dark shadow-lg shadow-gold/30 transition hover:bg-gold-light active:scale-95">
            {t('search')}
          </SearchButton>
        </div>
      </div>
      <div className="relative min-h-[50vh] overflow-hidden bg-brand-dark lg:min-h-0">
        <img
          src={HERO_IMAGE.src}
          srcSet={HERO_IMAGE.srcSet}
          sizes={HERO_IMAGE.sizes}
          width={HERO_IMAGE.width}
          height={HERO_IMAGE.height}
          alt={t('imageAlt')}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Blends the photograph's left edge into the brand panel beside it. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-brand/40 via-transparent to-transparent"
        />
        <div className="absolute top-8 right-6 max-w-[15rem] animate-float rounded-2xl bg-white px-5 py-4 shadow-2xl">
          <p className="flex items-center gap-1.5 text-sm font-bold text-brand">
            <Snowflake aria-hidden="true" size={14} />
            {t('cardTitle')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-subtle">{t('cardBody')}</p>
        </div>
      </div>
    </section>
  );
}

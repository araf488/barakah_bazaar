import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Eyebrow } from '../Eyebrow';
import { headingTags } from '../richText';
import { SearchButton } from '../SearchButton';

/** Rendered size of the panel photographs, for the browser to reserve space. */
const PANEL_IMAGE = { width: 800, height: 500 } as const;

/**
 * What each panel searches for. English, because product names are English-led and the API's
 * Bangla search is still weak (see SearchPanel's suggestions).
 */
export const PROMO_QUERIES = { doi: 'Doi', dates: 'Dates' } as const;

type PanelKey = keyof typeof PROMO_QUERIES;

const PANELS: ReadonlyArray<{ key: PanelKey; image: string; background: string; action: string }> =
  [
    {
      key: 'doi',
      image: '/images/home/promo-doi.webp',
      background: 'bg-brand',
      action: 'bg-white text-brand hover:bg-cream',
    },
    {
      key: 'dates',
      image: '/images/home/promo-dates.webp',
      background: 'bg-ink',
      action: 'bg-gold text-brand-dark hover:bg-gold-light',
    },
  ];

/**
 * Two editorial panels for the lines the Figma leads with. Each action opens the search with
 * that line typed in, since there is no promotion or landing page behind them. The photographs
 * are texture at low opacity, so they carry an empty alt; a dark scrim keeps the text legible
 * over their brightest pixels.
 */
export function PromoPanels() {
  const t = useTranslations('home.promo');

  return (
    <section className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8">
      {PANELS.map(({ key, image, background, action }) => (
        <article
          key={key}
          className={`relative flex min-h-[260px] items-end overflow-hidden rounded-3xl p-8 ${background}`}
        >
          <img
            src={image}
            alt=""
            width={PANEL_IMAGE.width}
            height={PANEL_IMAGE.height}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-brand-dark via-brand-dark/70 to-transparent"
          />
          <div className="relative">
            <Eyebrow className="text-gold-light">{t(`${key}Eyebrow`)}</Eyebrow>
            <h2 className="mt-2 mb-3 font-display text-3xl text-white">
              {t.rich(`${key}Title`, headingTags('text-white'))}
            </h2>
            <p className="mb-5 max-w-xs text-sm text-white/80">{t(`${key}Body`)}</p>
            <SearchButton
              query={PROMO_QUERIES[key]}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full px-6 text-sm font-semibold transition active:scale-95 ${action}`}
            >
              <Search aria-hidden="true" size={16} />
              {t(`${key}Action`)}
            </SearchButton>
          </div>
        </article>
      ))}
    </section>
  );
}

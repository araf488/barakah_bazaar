'use client';

import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Message keys of the announcements, in the order they scroll. */
export const ANNOUNCEMENT_KEYS = ['halal', 'fresh', 'dates', 'cod'] as const;

/**
 * The scrolling announcement strip. The list is rendered twice so the marquee loops without a
 * gap; the copy is hidden from assistive tech. WCAG 2.2.2 requires a way to stop content that
 * moves for more than five seconds, hence the pause button (hover pauses it too).
 */
export function AnnouncementBar() {
  const t = useTranslations('announcement');
  const [paused, setPaused] = useState(false);
  const items = ANNOUNCEMENT_KEYS.map((key) => t(key));

  return (
    <section aria-label={t('label')} className="group relative overflow-hidden bg-brand py-3">
      <div
        className={`flex w-max animate-marquee group-hover:[animation-play-state:paused] ${
          paused ? '[animation-play-state:paused]' : ''
        }`}
        data-testid="announcement-track"
      >
        <ul className="flex">
          {items.map((text) => (
            <li
              key={text}
              className="mx-14 text-sm font-medium tracking-wide whitespace-nowrap text-white/90"
            >
              {text}
            </li>
          ))}
        </ul>
        <ul className="flex" aria-hidden="true">
          {items.map((text) => (
            <li
              key={text}
              className="mx-14 text-sm font-medium tracking-wide whitespace-nowrap text-white/90"
            >
              {text}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        aria-label={paused ? t('play') : t('pause')}
        className="group/pause absolute inset-y-0 right-1 flex w-11 items-center justify-center focus-visible:outline-gold"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-dark/80 text-white/80 transition group-hover/pause:bg-brand-dark group-hover/pause:text-white group-active/pause:scale-90">
          {paused ? <Play aria-hidden="true" size={14} /> : <Pause aria-hidden="true" size={14} />}
        </span>
      </button>
    </section>
  );
}

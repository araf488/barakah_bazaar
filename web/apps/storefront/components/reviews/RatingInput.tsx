'use client';

import { formatCount } from '@barakah/ui';
import { Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { StorefrontLocale } from '../../i18n/messages';
import { RATINGS } from '../../lib/reviews/rules';

interface RatingInputProps {
  value: number | null;
  onChange: (rating: number) => void;
  invalid?: boolean;
  /** The form's error message, which the group points at while the rating is missing. */
  errorId?: string;
}

/**
 * One to five stars as a native radio group: arrow keys move between them, a screen reader hears
 * "4 stars, 4 of 5", and the form posts `rating` without JavaScript. The radios are visually
 * hidden; each star is its radio's label, and the label carries the focus ring.
 */
export function RatingInput({ value, onChange, invalid, errorId }: RatingInputProps) {
  const t = useTranslations('myReviews.form');
  const locale = useLocale() as StorefrontLocale;
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value ?? 0;

  return (
    <fieldset aria-describedby={invalid && errorId ? errorId : undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-ink">{t('rating')}</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex" onMouseLeave={() => setHovered(null)}>
          {RATINGS.map((rating) => (
            <label
              key={rating}
              onMouseEnter={() => setHovered(rating)}
              className="flex size-11 items-center justify-center rounded-lg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-0 has-[:focus-visible]:outline-brand"
            >
              <input
                type="radio"
                name="rating"
                value={rating}
                checked={value === rating}
                onChange={() => onChange(rating)}
                className="sr-only"
              />
              <span className="sr-only">{t('star', { count: rating })}</span>
              <Star
                aria-hidden="true"
                size={28}
                className={`transition-colors ${rating <= shown ? 'fill-gold text-gold' : 'text-subtle'}`}
              />
            </label>
          ))}
        </div>
        {value ? (
          <p className="text-sm text-subtle">
            {t('chosen', {
              rating: formatCount(value, locale),
              word: t(`ratingWords.${value}` as 'ratingWords.1'),
            })}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

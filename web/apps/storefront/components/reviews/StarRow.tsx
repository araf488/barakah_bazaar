import { Star } from 'lucide-react';

import { RATINGS } from '../../lib/reviews/rules';

/**
 * Five stars, filled up to `rating` (rounded). Decorative: whoever renders it also gives the
 * rating as text, so a screen reader hears "Rated 4 out of 5" rather than five images.
 */
export function StarRow({ rating, size = 16 }: { rating: number; size?: number }) {
  const filled = Math.round(rating);
  return (
    <span aria-hidden="true" className="inline-flex gap-0.5">
      {RATINGS.map((step) => (
        <Star
          key={step}
          size={size}
          className={step <= filled ? 'fill-gold text-gold' : 'text-gold/40'}
        />
      ))}
    </span>
  );
}

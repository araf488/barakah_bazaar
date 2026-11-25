import { CalendarClock, MapPin, Package, Snowflake } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ProductHandling } from '../../lib/api/catalog';
import { shelfLife } from '../../lib/variants';

/**
 * How the product travels, built only from the API's `handling` facts: perishables say which
 * cold chain they need, how long they keep and how far they can go. The Figma's free-text
 * "Same-day, order before 10 AM" note is gone; cut-off times belong to delivery slots.
 */
export function HandlingCard({ handling }: { handling: ProductHandling }) {
  const t = useTranslations('pdp');
  const perishable = handling.isPerishable;
  const keeps = handling.shelfLifeHours ? shelfLife(handling.shelfLifeHours) : null;

  return (
    <section
      aria-labelledby="handling-title"
      className={`rounded-2xl border p-4 ${perishable ? 'border-gold/30 bg-gold/10' : 'border-brand/15 bg-brand/5'}`}
    >
      <h2 id="handling-title" className="sr-only">
        {t('handlingTitle')}
      </h2>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        {perishable ? (
          <Snowflake aria-hidden="true" size={16} className="text-brand" />
        ) : (
          <Package aria-hidden="true" size={16} className="text-brand" />
        )}
        {perishable ? t('coldTitle') : t('standardTitle')}
      </p>
      <p className="mt-1 text-sm text-ink/70">
        {perishable ? t('coldBody', { storage: handling.storageType }) : t('standardBody')}
      </p>
      {keeps || handling.maxDeliveryDistanceKm ? (
        <ul className="mt-3 space-y-1.5 text-sm text-ink/70">
          {keeps ? (
            <li className="flex items-center gap-2">
              <CalendarClock aria-hidden="true" size={14} />
              {keeps.unit === 'days'
                ? t('shelfLifeDays', { value: keeps.value })
                : t('shelfLifeHours', { value: keeps.value })}
            </li>
          ) : null}
          {handling.maxDeliveryDistanceKm ? (
            <li className="flex items-center gap-2">
              <MapPin aria-hidden="true" size={14} />
              {t('distance', { km: handling.maxDeliveryDistanceKm })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

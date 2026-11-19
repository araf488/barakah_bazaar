import { CalendarClock, type LucideIcon, Snowflake, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Three facts the API enforces, in the order a shopper meets them: perishables only ride
 * cold-van slots, a slot is picked at checkout, payment is cash or bKash. They replace the
 * Figma's trust badges ("100% Halal Certified", "Order by 10 AM", "Easy Returns"), none of which
 * the backend or a document in this repository backs.
 */
const FACTS: ReadonlyArray<{ key: 'coldChain' | 'slot' | 'payment'; icon: LucideIcon }> = [
  { key: 'coldChain', icon: Snowflake },
  { key: 'slot', icon: CalendarClock },
  { key: 'payment', icon: Wallet },
];

export function DeliveryFacts() {
  const t = useTranslations('home.facts');

  return (
    <section aria-labelledby="facts-title" className="border-y border-border bg-warm py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id="facts-title" className="mb-8 font-display text-2xl text-ink">
          {t('title')}
        </h2>
        <ul className="grid gap-8 sm:grid-cols-3">
          {FACTS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <Icon aria-hidden="true" size={22} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink">{t(`${key}Title`)}</span>
                <span className="mt-1 block text-sm leading-relaxed text-ink/70">
                  {t(`${key}Body`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

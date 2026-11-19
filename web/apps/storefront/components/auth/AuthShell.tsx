import { Leaf, Snowflake, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { BrandMark } from '../shell/BrandMark';
import { Eyebrow } from '../Eyebrow';
import { headingTags } from '../richText';

/** Message namespaces under `auth` whose `heading` the brand panel shows. */
export type AuthView = 'signIn' | 'register' | 'verify' | 'forgot' | 'reset';

const FACTS = [
  { key: 'factHalal', icon: Leaf },
  { key: 'factCold', icon: Snowflake },
  { key: 'factPay', icon: Wallet },
] as const;

/**
 * The Figma auth modal as a page: brand panel beside the form. The panel's testimonial and its
 * "100% Halal certified" and "Same-day delivery" lines are gone (no source); its three facts are
 * the ones the API enforces.
 */
export function AuthShell({ view, children }: { view: AuthView; children: ReactNode }) {
  const t = useTranslations('auth');

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
      <div className="grid overflow-hidden rounded-3xl border border-border bg-white shadow-xl shadow-brand/5 md:grid-cols-[300px_1fr]">
        <aside className="relative hidden flex-col overflow-hidden bg-brand px-8 py-10 text-white md:flex">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-brand-light/25"
          />
          <BrandMark tone="onDark" />
          <div className="relative mt-12 flex-1">
            <Eyebrow className="mb-4 text-gold-light">{t('panel.eyebrow')}</Eyebrow>
            <p className="mb-8 font-display text-4xl leading-tight font-semibold">
              {t.rich(`${view}.heading`, headingTags('text-gold-light'))}
            </p>
            <ul className="space-y-4">
              {FACTS.map(({ key, icon: Icon }) => (
                <li key={key} className="flex items-center gap-3 text-sm text-white/80">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                    <Icon aria-hidden="true" size={16} />
                  </span>
                  {t(`panel.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <div className="px-6 py-8 sm:px-10 sm:py-10">{children}</div>
      </div>
    </div>
  );
}

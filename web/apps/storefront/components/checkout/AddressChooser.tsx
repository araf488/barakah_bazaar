'use client';

import { MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { useRouter } from '../../i18n/navigation';
import type { Address } from '../../lib/account/api';
import { placeLine } from '../../lib/account/format';
import { ROUTES } from '../../lib/routes';

const CARD =
  'flex cursor-pointer gap-3 rounded-2xl border border-border bg-white p-4 transition hover:border-brand has-[:checked]:border-brand has-[:checked]:ring-2 has-[:checked]:ring-brand/20 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand';

/**
 * The saved addresses as radio cards. Choosing one reloads the page for it, since the fee and
 * the delivery windows depend on the address and only the server can answer for them.
 */
export function AddressChooser({
  addresses,
  selectedId,
}: {
  addresses: Address[];
  selectedId: string;
}) {
  const t = useTranslations('checkout');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (id: string) =>
    startTransition(() => {
      router.replace({ pathname: ROUTES.checkout, query: { address: id } }, { scroll: false });
    });

  return (
    <fieldset aria-busy={pending} className="space-y-3">
      <legend className="sr-only">{t('address')}</legend>
      {addresses.map((address) => (
        <label key={address.id} className={CARD}>
          <input
            type="radio"
            name="addressChoice"
            value={address.id}
            checked={address.id === selectedId}
            onChange={() => choose(address.id)}
            className="mt-1 size-5 shrink-0 accent-brand"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <MapPin aria-hidden="true" size={14} className="text-brand" />
              {address.recipientName}
              <span className="font-normal text-subtle">
                · <span dir="ltr">{address.phone}</span>
              </span>
            </span>
            <span className="mt-1 block text-sm text-subtle">{placeLine(address)}</span>
          </span>
        </label>
      ))}
      <p aria-live="polite" className="min-h-5 text-sm text-subtle">
        {pending ? t('updating') : null}
      </p>
    </fieldset>
  );
}

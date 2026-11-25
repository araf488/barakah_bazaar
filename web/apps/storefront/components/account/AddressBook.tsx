'use client';

import { formatCount } from '@barakah/ui';
import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import type { Address } from '../../lib/account/api';
import { deleteAddressAction, setDefaultAddressAction } from '../../lib/account/actions';
import { placeLine } from '../../lib/account/format';
import { MAX_ADDRESSES } from '../../lib/account/rules';
import { ADDRESS_LABELS, AddressForm } from './AddressForm';

const ACTION =
  'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-subtle transition hover:bg-warm hover:text-brand active:scale-95';

function AddressCard({ address, onEdit }: { address: Address; onEdit: () => void }) {
  const t = useTranslations('address');
  const knownLabel = ADDRESS_LABELS.find((label) => label === address.label);
  const name = address.recipientName;

  return (
    <li className="rounded-2xl border border-border bg-white p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <MapPin aria-hidden="true" size={16} className="text-brand" />
        <span className="text-sm font-semibold text-ink">
          {knownLabel ? t(`labels.${knownLabel}`) : address.label}
        </span>
        {address.isDefault ? (
          <span className="rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-white">
            {t('default')}
          </span>
        ) : null}
      </div>
      <p className="text-sm font-medium text-ink">
        {name} · <span dir="ltr">{address.phone}</span>
      </p>
      <p className="mt-1 text-sm text-subtle">{placeLine(address)}</p>
      <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-2">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('editNamed', { name })}
          className={ACTION}
        >
          <Pencil aria-hidden="true" size={14} />
          {t('edit')}
        </button>
        {address.isDefault ? null : (
          <form action={setDefaultAddressAction}>
            <input type="hidden" name="id" value={address.id} />
            <button type="submit" aria-label={t('makeDefaultNamed', { name })} className={ACTION}>
              <Star aria-hidden="true" size={14} />
              {t('makeDefault')}
            </button>
          </form>
        )}
        <form action={deleteAddressAction}>
          <input type="hidden" name="id" value={address.id} />
          <button
            type="submit"
            aria-label={t('removeNamed', { name })}
            className={`${ACTION} hover:text-red-700`}
          >
            <Trash2 aria-hidden="true" size={14} />
            {t('remove')}
          </button>
        </form>
      </div>
    </li>
  );
}

/**
 * The saved addresses, default first, with one form open at a time: a new address, or the one
 * being edited in place. Its empty state says why an address helps (checkout in one tap).
 */
export function AddressBook({ addresses }: { addresses: Address[] }) {
  const t = useTranslations('address');
  const locale = useLocale();
  const [editing, setEditing] = useState<string | 'new' | null>(
    addresses.length === 0 ? 'new' : null,
  );
  const close = useCallback(() => setEditing(null), []);
  const full = addresses.length >= MAX_ADDRESSES;

  return (
    <div className="space-y-4">
      {addresses.length === 0 ? <p className="text-sm text-subtle">{t('empty')}</p> : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {addresses.map((address) =>
          editing === address.id ? (
            <li key={address.id} className="md:col-span-2">
              <AddressForm address={address} onDone={close} />
            </li>
          ) : (
            <AddressCard key={address.id} address={address} onEdit={() => setEditing(address.id)} />
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <AddressForm onDone={close} />
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          disabled={full}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-dashed border-border px-5 font-semibold text-brand transition hover:border-brand hover:bg-white disabled:opacity-50"
        >
          <Plus aria-hidden="true" size={18} />
          {t('add')}
          <span className="sr-only">
            ({formatCount(addresses.length, locale)}/{formatCount(MAX_ADDRESSES, locale)})
          </span>
        </button>
      )}
    </div>
  );
}

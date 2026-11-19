'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';

import type { Address } from '../../lib/account/api';
import { type AddressFormState, saveAddressAction } from '../../lib/account/actions';
import { MAX_ADDRESS_LINE_LENGTH, MAX_RECIPIENT_LENGTH } from '../../lib/account/rules';
import { FORM_ERROR_ID_SUFFIX, SubmitButton, TextField } from '../auth/fields';
import { PlacePicker } from './PlacePicker';

const IDLE: AddressFormState = { status: 'idle' };

/** The label chips, stored as these English words and shown in the reader's language. */
export const ADDRESS_LABELS = ['Home', 'Office', 'Other'] as const;

const FIELD_FOR_ERROR: Partial<Record<string, string>> = {
  nameMissing: 'recipientName',
  phoneInvalid: 'phone',
  lineMissing: 'addressLine',
  postCodeInvalid: 'postCode',
};

interface AddressFormProps {
  /** Present when editing; absent for a new address. */
  address?: Address;
  onDone: () => void;
}

/**
 * New or edited address: a label chip, recipient and mobile, the place chain, the house and
 * road, and an optional post code (filled in from the chosen area when it has one). Validated
 * here first and again by the API, which also checks the place chain.
 */
export function AddressForm({ address, onDone }: AddressFormProps) {
  const t = useTranslations('address');
  const [state, action] = useActionState(saveAddressAction, IDLE);
  const [label, setLabel] = useState(address?.label ?? 'Home');
  const [recipientName, setRecipientName] = useState(address?.recipientName ?? '');
  const [phone, setPhone] = useState(address?.phone ?? '');
  const [addressLine, setAddressLine] = useState(address?.addressLine ?? '');
  const [postCode, setPostCode] = useState(address?.postCode ?? '');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;
  const invalidField = state.status === 'error' ? FIELD_FOR_ERROR[state.error] : undefined;

  useEffect(() => {
    if (state.status === 'saved') {
      onDone();
    }
  }, [state, onDone]);

  return (
    <form
      action={action}
      noValidate
      className="space-y-4 rounded-2xl border border-border bg-white p-5"
    >
      <h3 className="font-display text-lg font-semibold text-ink">
        {address ? t('editTitle') : t('newTitle')}
      </h3>
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">{t('labelField')}</legend>
        <div className="flex flex-wrap gap-2">
          {ADDRESS_LABELS.map((option) => (
            <label
              key={option}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-border bg-white px-4 text-sm font-medium text-ink transition has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand"
            >
              <input
                type="radio"
                name="label"
                value={option}
                checked={label === option}
                onChange={() => setLabel(option)}
                className="sr-only"
              />
              {t(`labels.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField
        name="recipientName"
        label={t('fields.recipientName')}
        value={recipientName}
        onValueChange={setRecipientName}
        autoComplete="name"
        maxLength={MAX_RECIPIENT_LENGTH}
        invalid={invalidField === 'recipientName'}
        errorId={errorId}
        required
      />
      <TextField
        name="phone"
        type="tel"
        inputMode="tel"
        label={t('fields.phone')}
        value={phone}
        onValueChange={setPhone}
        autoComplete="tel"
        hint={t('fields.phoneHint')}
        invalid={invalidField === 'phone'}
        errorId={errorId}
        required
      />
      <PlacePicker
        initial={{
          division: address?.division ?? '',
          district: address?.district ?? '',
          unit: address?.unit ?? '',
          area: address?.area ?? '',
        }}
        initialUnlisted={false}
        onArea={(area) => area?.postCode && setPostCode(area.postCode)}
        invalid={state.status === 'error' && state.error === 'placeMissing'}
        errorId={errorId}
      />
      <TextField
        name="addressLine"
        label={t('fields.addressLine')}
        value={addressLine}
        onValueChange={setAddressLine}
        autoComplete="street-address"
        maxLength={MAX_ADDRESS_LINE_LENGTH}
        invalid={invalidField === 'addressLine'}
        errorId={errorId}
        required
      />
      <TextField
        name="postCode"
        inputMode="numeric"
        label={t('fields.postCode')}
        value={postCode}
        onValueChange={setPostCode}
        autoComplete="postal-code"
        maxLength={4}
        invalid={invalidField === 'postCode'}
        errorId={errorId}
      />
      {state.status === 'error' ? (
        <p
          id={errorId}
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <SubmitButton label={t('save')} pending={t('saving')} />
        </div>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-subtle transition hover:bg-warm hover:text-ink"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

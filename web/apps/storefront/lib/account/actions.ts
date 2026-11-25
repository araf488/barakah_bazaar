'use server';

import { refresh } from 'next/cache';

import { type AddressInput, addressApi } from './api';
import { accountCaller } from './caller';
import { type AddressFieldError, checkAddress, MAX_LABEL_LENGTH, normalizePhone } from './rules';

/** Message keys under `address.errors`. */
export type AddressErrorKey =
  AddressFieldError | 'invalid' | 'tooMany' | 'notFound' | 'signedOut' | 'failed';

export type AddressFormState =
  | { status: 'idle' }
  | { status: 'saved'; at: number }
  | { status: 'error'; error: AddressErrorKey };

const STATUS_TO_ERROR: Readonly<Record<number, AddressErrorKey>> = {
  400: 'invalid',
  401: 'signedOut',
  404: 'notFound',
  409: 'tooMany',
};

const field = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

const inputOf = (form: FormData): AddressInput => {
  const label = field(form, 'label').slice(0, MAX_LABEL_LENGTH);
  const area = field(form, 'area');
  const postCode = field(form, 'postCode');
  return {
    recipientName: field(form, 'recipientName'),
    phone: normalizePhone(field(form, 'phone')),
    division: field(form, 'division'),
    district: field(form, 'district'),
    unit: field(form, 'unit'),
    addressLine: field(form, 'addressLine'),
    ...(label ? { label } : {}),
    ...(area ? { area } : {}),
    ...(postCode ? { postCode } : {}),
    ...(form.get('unlistedLocation') === 'on' ? { unlistedLocation: true } : {}),
  };
};

/** Adds an address, or updates the one named by `id`; the API validates the place chain. */
export async function saveAddressAction(
  _prev: AddressFormState,
  form: FormData,
): Promise<AddressFormState> {
  const input = inputOf(form);
  const invalid = checkAddress({ ...input, postCode: input.postCode ?? '' });
  if (invalid) {
    return { status: 'error', error: invalid };
  }
  const caller = await accountCaller();
  if (!caller) {
    return { status: 'error', error: 'signedOut' };
  }
  const id = field(form, 'id');
  const result = id
    ? await addressApi.update(caller, id, input)
    : await addressApi.create(caller, input);
  if (!result.ok) {
    return { status: 'error', error: STATUS_TO_ERROR[result.status] ?? 'failed' };
  }
  refresh();
  return { status: 'saved', at: Date.now() };
}

/** Removes an address. */
export async function deleteAddressAction(form: FormData): Promise<void> {
  const caller = await accountCaller();
  const id = field(form, 'id');
  if (caller && id) {
    await addressApi.remove(caller, id);
    refresh();
  }
}

/** Makes an address the default for checkout. */
export async function setDefaultAddressAction(form: FormData): Promise<void> {
  const caller = await accountCaller();
  const id = field(form, 'id');
  if (caller && id) {
    await addressApi.setDefault(caller, id);
    refresh();
  }
}

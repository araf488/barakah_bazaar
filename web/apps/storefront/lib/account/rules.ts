/** Mirrors the API's address rules (src/modules/user/user.constants.ts, common/phone). */
export const BANGLADESH_MOBILE_PATTERN = /^(?:\+8801|01)[3-9]\d{8}$/;
export const POST_CODE_PATTERN = /^\d{4}$/;
export const MAX_LABEL_LENGTH = 40;
export const MAX_RECIPIENT_LENGTH = 120;
export const MAX_ADDRESS_LINE_LENGTH = 255;
export const MAX_PLACE_LENGTH = 80;
export const MAX_ADDRESSES = 20;

export type AddressFieldError =
  'nameMissing' | 'phoneInvalid' | 'placeMissing' | 'lineMissing' | 'postCodeInvalid';

const BENGALI_ZERO = 0x09e6;

/**
 * A phone number as the API wants it: Bengali digits (typed on a Bangla keyboard, ০১৭১২…)
 * become Latin, and the spaces and dashes people type ("01712-345678") go.
 */
export const normalizePhone = (value: string): string =>
  value
    .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - BENGALI_ZERO))
    .replace(/[\s-]/g, '');

export interface AddressFields {
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  unit: string;
  addressLine: string;
  postCode: string;
}

/** The first problem with the form, in the order the fields appear, or `null`. */
export const checkAddress = (fields: AddressFields): AddressFieldError | null => {
  if (!fields.recipientName || fields.recipientName.length > MAX_RECIPIENT_LENGTH)
    return 'nameMissing';
  if (!BANGLADESH_MOBILE_PATTERN.test(normalizePhone(fields.phone))) return 'phoneInvalid';
  if (!fields.division || !fields.district || !fields.unit) return 'placeMissing';
  if (!fields.addressLine || fields.addressLine.length > MAX_ADDRESS_LINE_LENGTH)
    return 'lineMissing';
  if (fields.postCode && !POST_CODE_PATTERN.test(fields.postCode)) return 'postCodeInvalid';
  return null;
};

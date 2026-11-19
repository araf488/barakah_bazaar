import { describe, expect, it } from 'vitest';

import { checkAddress, normalizePhone } from '../rules';

const VALID = {
  recipientName: 'Tahmina',
  phone: '01712345678',
  division: 'Dhaka',
  district: 'Dhaka',
  unit: 'Gulshan',
  addressLine: 'House 12',
  postCode: '',
};

describe('normalizePhone', () => {
  it('turns Bengali digits typed on a Bangla keyboard into Latin ones', () => {
    expect(normalizePhone('০১৭১২৩৪৫৬৭৮')).toBe('01712345678');
  });

  it('drops the spaces and dashes people type', () => {
    expect(normalizePhone('01712-345 678')).toBe('01712345678');
  });
});

describe('checkAddress', () => {
  it('accepts a complete address, with or without +880', () => {
    expect(checkAddress(VALID)).toBeNull();
    expect(checkAddress({ ...VALID, phone: '+8801712345678' })).toBeNull();
    expect(checkAddress({ ...VALID, phone: '০১৭১২-৩৪৫৬৭৮' })).toBeNull();
  });

  it.each([
    [{ recipientName: '' }, 'nameMissing'],
    [{ phone: '01212345678' }, 'phoneInvalid'],
    [{ phone: '1712345678' }, 'phoneInvalid'],
    [{ unit: '' }, 'placeMissing'],
    [{ district: '' }, 'placeMissing'],
    [{ addressLine: '' }, 'lineMissing'],
    [{ postCode: '12' }, 'postCodeInvalid'],
  ])('refuses %o as %s', (override, error) => {
    expect(checkAddress({ ...VALID, ...override })).toBe(error);
  });
});

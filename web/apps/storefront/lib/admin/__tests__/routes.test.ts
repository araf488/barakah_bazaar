import { describe, expect, it } from 'vitest';

import { safeAdminNext, SHOP_ROUTES, signInPathFor } from '../routes';

describe('safeAdminNext', () => {
  it.each(['/admin', '/admin/orders/1?tab=items'])('keeps the admin path %s', (path) => {
    expect(safeAdminNext(path)).toBe(path);
  });

  it.each([
    undefined,
    '',
    '/',
    '/bn/account',
    '/administrator',
    '//evil.example/admin',
    '/admin\\..\\x',
    'https://evil.example/admin',
    ['/admin/orders'],
  ])('sends %j to the overview', (value) => {
    expect(safeAdminNext(value)).toBe('/admin');
  });
});

describe('signInPathFor', () => {
  it('remembers where the staff member was going', () => {
    expect(signInPathFor('/admin/orders/1')).toBe('/admin/sign-in?next=%2Fadmin%2Forders%2F1');
  });

  it('needs no reminder for the overview, nor for anything unsafe', () => {
    expect(signInPathFor('/admin')).toBe('/admin/sign-in');
    expect(signInPathFor('//evil.example')).toBe('/admin/sign-in');
  });
});

describe('SHOP_ROUTES', () => {
  it('links the shop in English, matching the portal', () => {
    expect(SHOP_ROUTES).toEqual({ home: '/en/', forgotPassword: '/en/forgot-password' });
  });
});

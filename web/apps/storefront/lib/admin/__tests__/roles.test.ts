import { describe, expect, it } from 'vitest';

import { canOpen, isStaffRole, ROLE_LABELS, sectionsFor, STAFF_ROLES } from '../roles';

describe('isStaffRole', () => {
  it.each(STAFF_ROLES)('counts %s as staff', (role) => {
    expect(isStaffRole(role)).toBe(true);
  });

  it.each(['CUSTOMER', '', 'super_admin'])('does not count %j', (role) => {
    expect(isStaffRole(role)).toBe(false);
  });
});

describe('sections', () => {
  it('gives every staff role the overview', () => {
    for (const role of STAFF_ROLES) {
      expect(sectionsFor(role).map((section) => section.key)).toEqual(['overview']);
    }
  });

  it('keeps a role-limited section from roles not on its list', () => {
    const ordersOnly = {
      key: 'overview' as const,
      label: 'Orders',
      path: '/admin/orders',
      roles: ['OPS'] as const,
    };
    expect(canOpen(ordersOnly, 'OPS')).toBe(true);
    expect(canOpen(ordersOnly, 'MARKETING')).toBe(false);
  });

  it('names every role', () => {
    expect(ROLE_LABELS).toEqual({
      SUPER_ADMIN: 'Super admin',
      OPS: 'Operations',
      WAREHOUSE: 'Warehouse',
      MARKETING: 'Marketing',
      SUPPORT: 'Support',
    });
  });
});

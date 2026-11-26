// Who may open which part of the portal. Mirrors the API's `@Roles` decorators: the API is the
// authority and refuses anything this gets wrong; this only keeps staff from seeing links and
// pages that would answer 403.

export const STAFF_ROLES = ['SUPER_ADMIN', 'OPS', 'WAREHOUSE', 'MARKETING', 'SUPPORT'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const isStaffRole = (role: string): role is StaffRole =>
  (STAFF_ROLES as readonly string[]).includes(role);

/** How each role reads in the portal. */
export const ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  SUPER_ADMIN: 'Super admin',
  OPS: 'Operations',
  WAREHOUSE: 'Warehouse',
  MARKETING: 'Marketing',
  SUPPORT: 'Support',
};

export type AdminSectionKey = 'overview';

export interface AdminSection {
  key: AdminSectionKey;
  label: string;
  path: string;
  /** Every staff role when absent. */
  roles?: readonly StaffRole[];
}

/**
 * The portal's sections, in sidebar order. A section is listed only once its pages exist, so the
 * sidebar never links to a page that is not there; later phases add orders, catalog and the rest.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: 'overview', label: 'Overview', path: '/admin' },
];

export const canOpen = (section: AdminSection, role: StaffRole): boolean =>
  !section.roles || section.roles.includes(role);

/** The sections this role may open, in sidebar order. */
export const sectionsFor = (role: StaffRole): AdminSection[] =>
  ADMIN_SECTIONS.filter((section) => canOpen(section, role));
